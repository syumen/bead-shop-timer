// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../../db/database';
import type { Session } from '../../db/models';
import { endSession, startSession } from '../../services/sessionService';
import TodayCompletedSessions from './TodayCompletedSessions';

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
const dayStart = new Date(2026, 8, 22).getTime();
const nextDayStart = new Date(2026, 8, 23).getTime();
const minute = 60_000;
let now: number;
let container: HTMLDivElement;
let root: Root;

function completed(id: string, startedAt: number, endedAt: number | null): Session {
  return { id, seatId: 'seat-7', status: 'completed', startedAt, endedAt, createdAt: startedAt, updatedAt: endedAt ?? startedAt };
}

beforeAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  now = new Date(2026, 8, 22, 12).getTime();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  await db.delete();
  await db.open();
  await db.seats.add({ id: 'seat-7', seatNumber: 7, x: 80, y: 80, width: 64, height: 64, rotation: 0, isActive: true, createdAt: 1, updatedAt: 1 });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  await db.delete();
});
afterAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment; });

async function waitForUI(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    assertion();
  }, { timeout: 2000, interval: 10 });
}
async function renderList() {
  await act(async () => root.render(<TodayCompletedSessions />));
  await waitForUI(() => expect(container.textContent).not.toContain('正在加载'));
}
function rows() { return Array.from(container.querySelectorAll('tbody tr')); }

it('无记录时显示今日暂无已结束记录', async () => {
  await renderList();
  expect(container.textContent).toContain('今日暂无已结束记录');
  expect(rows()).toHaveLength(0);
});

it('按本地 startedAt 归属今天，包含两端边界内 completed，排除 active 和其他日期', async () => {
  await db.sessions.bulkAdd([
    completed('start-boundary', dayStart, dayStart + minute),
    completed('cross-midnight', nextDayStart - 1, nextDayStart + 10 * minute),
    completed('yesterday-cross-midnight', dayStart - 1, dayStart + 20 * minute),
    completed('tomorrow-boundary', nextDayStart, nextDayStart + minute),
    { ...completed('active', dayStart + minute, null), status: 'active' },
  ]);
  await renderList();
  expect(rows()).toHaveLength(2);
  expect(rows().map((row) => row.children[1].textContent)).toEqual([
    new Date(nextDayStart - 1).toLocaleString('zh-CN', { hour12: false }),
    new Date(dayStart).toLocaleString('zh-CN', { hour12: false }),
  ]);
});

it('按 endedAt 倒序显示，正确展示座位、本地起止时间和分钟时长', async () => {
  const first = completed('a', dayStart, dayStart + 106 * minute + 59_000);
  const second = completed('z', dayStart + 90 * minute, dayStart + 128 * minute);
  await db.sessions.bulkAdd([second, first]);
  await renderList();
  expect(rows().map((row) => Array.from(row.children).map((cell) => cell.textContent))).toEqual(
    [second, first].map((session, index) => [
      '座位 7',
      new Date(session.startedAt).toLocaleString('zh-CN', { hour12: false }),
      new Date(session.endedAt!).toLocaleString('zh-CN', { hour12: false }),
      index === 0 ? '38分钟' : '1小时 46分钟',
    ]),
  );
});

it('软删除座位保留编号，缺失座位显示未知座位；只读展示不修改 Session 或日志', async () => {
  await db.seats.update('seat-7', { isActive: false });
  await db.sessions.bulkAdd([
    completed('history', dayStart, dayStart + minute),
    { ...completed('missing', dayStart, dayStart + 2 * minute), seatId: 'missing-seat' },
  ]);
  await db.operationLogs.add({ id: 'log', seatId: 'seat-7', sessionId: 'history', action: 'END', occurredAt: dayStart + minute });
  const sessions = await db.sessions.toArray();
  const logs = await db.operationLogs.toArray();
  const seats = await db.seats.toArray();
  await renderList();
  expect(rows().map((row) => row.children[0].textContent)).toEqual(['未知座位', '座位 7']);
  expect(container.querySelector('button, input, select')).toBeNull();
  expect(await db.sessions.toArray()).toEqual(sessions);
  expect(await db.operationLogs.toArray()).toEqual(logs);
  expect(await db.seats.toArray()).toEqual(seats);
});

it('END 后由 live query 自动新增记录，重新读取后仍显示相同记录', async () => {
  const session = await startSession('seat-7');
  await renderList();
  expect(rows()).toHaveLength(0);
  now += 38 * minute;
  await act(async () => { await endSession(session.id); });
  await waitForUI(() => expect(rows()[0]?.children[3].textContent).toBe('38分钟'));
  const original = container.textContent;
  await act(async () => root.unmount());
  root = createRoot(container);
  await renderList();
  expect(container.textContent).toBe(original);
  expect(await db.operationLogs.count()).toBe(2);
});

it('营业页跨本地午夜后更新日期范围，无需数据写入', async () => {
  now = nextDayStart - 1000;
  const session = completed('today', dayStart, dayStart + minute);
  await db.sessions.add(session);
  await renderList();
  expect(rows()).toHaveLength(1);
  now = nextDayStart;
  await waitForUI(() => expect(container.textContent).toContain('今日暂无已结束记录'));
  expect(await db.sessions.toArray()).toEqual([session]);
  expect(await db.operationLogs.count()).toBe(0);
});

it('异常 endedAt 记录保留并标明时长异常，不导致页面报错或修改数据', async () => {
  await db.sessions.bulkAdd([
    completed('null-end', dayStart, null),
    completed('negative-duration', dayStart + minute, dayStart),
  ]);
  await renderList();
  expect(rows()).toHaveLength(2);
  expect(rows().map((row) => row.children[3].textContent)).toEqual(['时长异常', '时长异常']);
  expect(rows()[1].children[2].textContent).toBe('—');
});
