// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadShopDB, db } from '../db/database';
import LayoutCanvas from '../components/layout/LayoutCanvas';
import { mapActiveSessionsBySeat } from '../components/layout/SeatStatus';
import LogsPage from '../pages/LogsPage';
import { addSeat, removeSeat, updateSeatPosition } from '../services/layoutService';
import { endSession, startSession } from '../services/sessionService';
import { getDailyStats, getMonthlyStats, getWeeklyStats } from '../services/statsService';

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
const minute = 60_000;
const zeroStats = {
  totalVisitors: 0, completedVisitors: 0, currentVisitors: 0,
  totalDurationMs: 0, averageDurationMs: 0,
};
let now: number;
let container: HTMLDivElement;
let root: Root | null;

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  now = new Date(2026, 8, 21, 10).getTime();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  await db.delete();
  await db.open();
  container = document.createElement('div');
  document.body.append(container);
  root = null;
});

afterEach(async () => {
  await unmountPage();
  container.remove();
  vi.restoreAllMocks();
  await db.delete();
});

afterAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

async function renderPage(page: ReactNode) {
  const mountedRoot = root ??= createRoot(container);
  await act(async () => mountedRoot.render(page));
}

async function unmountPage() {
  const mountedRoot = root;
  root = null;
  if (mountedRoot) await act(async () => mountedRoot.unmount());
}

async function waitForUI(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    assertion();
  }, { timeout: 2_000, interval: 10 });
}

async function snapshotDatabase() {
  const [seats, tables, sessions, operationLogs] = await Promise.all([
    db.seats.toArray(), db.layoutTables.toArray(), db.sessions.toArray(), db.operationLogs.toArray(),
  ]);
  return { seats, tables, sessions, operationLogs };
}

describe('V1 数据一致性集成测试', () => {
  it('Seat → START → END 只产生一个 completed Session 和对应的一对 START/END 日志', async () => {
    const seat = await addSeat();
    now += minute;
    const active = await startSession(seat.id);
    now += 60 * minute;
    const completed = await endSession(active.id);

    expect(await db.sessions.toArray()).toEqual([{
      ...active, status: 'completed', endedAt: now, updatedAt: now,
    }]);
    expect(completed).toEqual(await db.sessions.get(active.id));
    const logs = await db.operationLogs.toArray();
    expect(logs).toHaveLength(2);
    expect(logs.filter((log) => log.action === 'START')).toEqual([{
      id: expect.any(String), sessionId: active.id, seatId: seat.id,
      action: 'START', occurredAt: active.startedAt,
    }]);
    expect(logs.filter((log) => log.action === 'END')).toEqual([{
      id: expect.any(String), sessionId: active.id, seatId: seat.id,
      action: 'END', occurredAt: completed.endedAt,
    }]);
    expect(new Set(logs.map((log) => log.id)).size).toBe(2);
  });

  it('几乎同时 START 两次，只成功一次且仅有一个 active Session 和一条 START 日志', async () => {
    const seat = await addSeat();

    const results = await Promise.allSettled([startSession(seat.id), startSession(seat.id)]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.reason.message).toContain('不能重复开始');
    const sessions = await db.sessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ seatId: seat.id, status: 'active', endedAt: null });
    expect(await db.operationLogs.toArray()).toEqual([{
      id: expect.any(String), sessionId: sessions[0].id, seatId: seat.id,
      action: 'START', occurredAt: sessions[0].startedAt,
    }]);
  });

  it('几乎同时 END 两次，只成功一次且仅追加一条 END 日志', async () => {
    const seat = await addSeat();
    const active = await startSession(seat.id);
    const startLogs = await db.operationLogs.toArray();
    now += minute;

    const results = await Promise.allSettled([endSession(active.id), endSession(active.id)]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.reason.message).toContain('不能重复结束');
    expect(await db.sessions.toArray()).toEqual([{
      ...active, status: 'completed', endedAt: now, updatedAt: now,
    }]);
    const logs = await db.operationLogs.toArray();
    expect(logs).toHaveLength(2);
    expect(logs.filter((log) => log.action === 'START')).toEqual(startLogs);
    expect(logs.filter((log) => log.action === 'END')).toEqual([{
      id: expect.any(String), sessionId: active.id, seatId: seat.id, action: 'END', occurredAt: now,
    }]);
  });

  it('计时中的 Seat 无法软删除，座位与计时原始数据均保持不变', async () => {
    const seat = await addSeat();
    await startSession(seat.id);
    const before = await snapshotDatabase();
    now += minute;

    await expect(removeSeat(seat.id)).rejects.toThrow('正在计时');

    expect(await db.seats.get(seat.id)).toEqual(seat);
    expect(await snapshotDatabase()).toEqual(before);
  });

  it('completed 后允许软删除 Seat，保留 Session 和日志且禁止再次 START', async () => {
    const seat = await addSeat();
    const active = await startSession(seat.id);
    now += minute;
    const completed = await endSession(active.id);
    const logs = await db.operationLogs.toArray();
    now += minute;

    await removeSeat(seat.id);

    expect(await db.seats.get(seat.id)).toEqual({ ...seat, isActive: false, updatedAt: now });
    expect(await db.sessions.toArray()).toEqual([completed]);
    expect(await db.operationLogs.toArray()).toEqual(logs);
    const afterDelete = await snapshotDatabase();
    await expect(startSession(seat.id)).rejects.toThrow('座位不存在或未启用');
    expect(await snapshotDatabase()).toEqual(afterDelete);
  });

  it('START 后调整 Seat 位置不改变 Session id、startedAt 或任何日志', async () => {
    const seat = await addSeat();
    const active = await startSession(seat.id);
    const logs = await db.operationLogs.toArray();
    now += 5 * minute;

    await updateSeatPosition(seat.id, 320, 240);

    expect(await db.seats.get(seat.id)).toEqual({ ...seat, x: 320, y: 240, updatedAt: now });
    expect(await db.sessions.toArray()).toEqual([active]);
    expect(await db.operationLogs.toArray()).toEqual(logs);
  });

  it('关闭数据库后用新连接识别 active Session，重新挂载页面按原始 startedAt 恢复计时', async () => {
    const seat = await addSeat();
    const active = await startSession(seat.id);
    const before = await snapshotDatabase();
    await renderPage(<LayoutCanvas />);
    await waitForUI(() => expect(container.querySelector('[aria-label="座位 1"]')?.textContent).toContain('00:00:00'));
    await unmountPage();
    db.close();

    const reopened = new BeadShopDB();
    try {
      await reopened.open();
      const reloaded = await reopened.sessions.where('[seatId+status]').equals([seat.id, 'active']).toArray();
      expect(reloaded).toEqual([active]);
      expect(mapActiveSessionsBySeat(reloaded).get(seat.id)).toEqual(active);
    } finally {
      reopened.close();
    }
    await db.open();
    now += 61_000;
    await renderPage(<LayoutCanvas />);
    await waitForUI(() => {
      const displayedSeat = container.querySelector('[aria-label="座位 1"]');
      expect(displayedSeat?.textContent).toContain('00:01:01');
      expect(displayedSeat?.textContent).not.toContain('空闲');
    });
    expect(await snapshotDatabase()).toEqual(before);
  });

  it.each([
    { label: '日', getStats: getDailyStats, visitors: 2, completed: 1, durationMinutes: 90 },
    { label: '周', getStats: getWeeklyStats, visitors: 2, completed: 1, durationMinutes: 90 },
    { label: '月', getStats: getMonthlyStats, visitors: 3, completed: 2, durationMinutes: 180 },
  ])('$label 统计不修改 Session、日志数量或任何原始字段', async ({ getStats, visitors, completed, durationMinutes }) => {
    now = new Date(2026, 8, 20, 23, 30).getTime();
    const firstSeat = await addSeat();
    const secondSeat = await addSeat();
    const overnight = await startSession(firstSeat.id);
    now = new Date(2026, 8, 21, 1).getTime();
    await endSession(overnight.id);
    now = new Date(2026, 8, 21, 9).getTime();
    const morning = await startSession(secondSeat.id);
    now += 90 * minute;
    await endSession(morning.id);
    await removeSeat(secondSeat.id);
    now = new Date(2026, 8, 21, 11).getTime();
    await startSession(firstSeat.id);
    const before = await snapshotDatabase();

    const stats = await getStats(new Date(now));

    expect(stats).toEqual({
      totalVisitors: visitors, completedVisitors: completed, currentVisitors: 1,
      totalDurationMs: durationMinutes * minute, averageDurationMs: 90 * minute,
    });
    const after = await snapshotDatabase();
    expect(after.sessions).toHaveLength(before.sessions.length);
    expect(after.operationLogs).toHaveLength(before.operationLogs.length);
    expect(after).toEqual(before);
  });

  it('空数据库的营业页面可正常读取，日周月统计均为 0 且不创建数据', async () => {
    await renderPage(<LayoutCanvas />);
    await waitForUI(() => expect(container.textContent).toContain('暂无座位，请进入布局编辑添加'));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    const activeSessions = await db.sessions.filter((session) => session.status === 'active').toArray();
    expect(mapActiveSessionsBySeat(activeSessions).size).toBe(0);

    const stats = await Promise.all([
      getDailyStats(new Date(now)), getWeeklyStats(new Date(now)), getMonthlyStats(new Date(now)),
    ]);

    expect(stats).toEqual([zeroStats, zeroStats, zeroStats]);
    expect(await snapshotDatabase()).toEqual({ seats: [], tables: [], sessions: [], operationLogs: [] });
  });

  it('历史座位软删除并重开数据库后，多次 Session 和日志仍关联原座位编号', async () => {
    const seat = await addSeat();
    const first = await startSession(seat.id);
    now += minute;
    await endSession(first.id);
    now += minute;
    const second = await startSession(seat.id);
    now += minute;
    await endSession(second.id);
    await removeSeat(seat.id);
    const newerSeat = await addSeat();
    expect(newerSeat.seatNumber).toBe(2);
    const before = await snapshotDatabase();
    db.close();
    await db.open();

    const sessions = await db.sessions.toArray();
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.seatId === seat.id && session.status === 'completed')).toBe(true);
    const logs = await db.operationLogs.toArray();
    expect(logs).toHaveLength(4);
    for (const log of logs) {
      expect(await db.seats.get(log.seatId)).toMatchObject({ id: seat.id, seatNumber: 1, isActive: false });
      expect(await db.sessions.get(log.sessionId)).toMatchObject({ seatId: log.seatId, status: 'completed' });
    }
    await renderPage(<LogsPage />);
    await waitForUI(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(4));
    const rows = Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr'));
    expect(rows.map((row) => row.cells[1].textContent)).toEqual(['座位 1', '座位 1', '座位 1', '座位 1']);
    expect(rows.map((row) => row.cells[2].textContent).sort()).toEqual(['开始计时', '开始计时', '结束计时', '结束计时']);
    expect(container.textContent).not.toContain('未知座位');
    expect(await snapshotDatabase()).toEqual(before);
  });

  it.each(['START 先提交', '删除先提交'])('%s：并发 START 与删除不会留下停用座位的 active Session', async (order) => {
    const seat = await addSeat();
    const actions = order === 'START 先提交'
      ? [() => startSession(seat.id), () => removeSeat(seat.id)]
      : [() => removeSeat(seat.id), () => startSession(seat.id)];

    const results = await Promise.allSettled(actions.map((action) => action()));

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const storedSeat = await db.seats.get(seat.id);
    expect(storedSeat).toBeDefined();
    const sessions = await db.sessions.toArray();
    const logs = await db.operationLogs.toArray();
    if (storedSeat?.isActive) {
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ seatId: seat.id, status: 'active' });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ seatId: seat.id, sessionId: sessions[0].id, action: 'START' });
    } else {
      expect(sessions).toEqual([]);
      expect(logs).toEqual([]);
    }
  });

  it('START 日志因主键冲突写入失败时，Session 一并回滚且可以重试', async () => {
    const previousSeat = await addSeat();
    const targetSeat = await addSeat();
    const previous = await startSession(previousSeat.id);
    now += minute;
    await endSession(previous.id);
    const before = await snapshotDatabase();
    const existingLogId = before.operationLogs[0].id as ReturnType<typeof crypto.randomUUID>;
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(existingLogId);

    await expect(startSession(targetSeat.id)).rejects.toMatchObject({ name: 'ConstraintError' });

    expect(await snapshotDatabase()).toEqual(before);
    uuid.mockRestore();
    const active = await startSession(targetSeat.id);
    expect(active).toMatchObject({ seatId: targetSeat.id, status: 'active' });
    expect(await db.sessions.count()).toBe(2);
    expect(await db.operationLogs.count()).toBe(3);
  });

  it('END 日志因主键冲突写入失败时，Session 保持 active 且重试仅产生一条 END', async () => {
    const seat = await addSeat();
    const active = await startSession(seat.id);
    const before = await snapshotDatabase();
    const existingLogId = before.operationLogs[0].id as ReturnType<typeof crypto.randomUUID>;
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(existingLogId);
    now += minute;

    await expect(endSession(active.id)).rejects.toMatchObject({ name: 'ConstraintError' });

    expect(await snapshotDatabase()).toEqual(before);
    uuid.mockRestore();
    await endSession(active.id);
    expect(await db.sessions.toArray()).toEqual([{
      ...active, status: 'completed', endedAt: now, updatedAt: now,
    }]);
    const logs = await db.operationLogs.toArray();
    expect(logs).toHaveLength(2);
    expect(logs.filter((log) => log.action === 'START')).toEqual(before.operationLogs);
    expect(logs.filter((log) => log.action === 'END')).toHaveLength(1);
  });
});
