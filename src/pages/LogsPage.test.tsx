// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { db } from '../db/database';
import type { OperationLog, Seat, Session } from '../db/models';
import LogsPage from './LogsPage';

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
const seat: Seat = {
  id: 'seat-logs-test', seatNumber: 7, x: 80, y: 80, width: 64, height: 64,
  rotation: 0, isActive: true, createdAt: 1, updatedAt: 1,
};
const startLog: OperationLog = {
  id: 'start-log', sessionId: 'session-logs-test', seatId: seat.id,
  action: 'START', occurredAt: 1_700_000_123_000,
};
let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.seats.add(seat);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await db.delete();
});

afterAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

async function waitForUI(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    assertion();
  }, { timeout: 2_000, interval: 10 });
}

async function renderLogs() {
  await act(async () => root.render(<LogsPage />));
  await waitForUI(() => expect(container.textContent).not.toContain('正在加载操作记录…'));
}

function rows(): HTMLTableRowElement[] {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr'));
}

function button(text: string): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === text);
  if (!element) throw new Error(`未找到按钮：${text}`);
  return element;
}

describe('LogsPage', () => {
  it.each(['START', 'END'] as const)('正确显示 %s 日志、座位编号和精确到秒的本地操作时间', async (action) => {
    await db.operationLogs.add({ ...startLog, action });

    await renderLogs();

    expect(rows()).toHaveLength(1);
    const cells = rows()[0].cells;
    expect(cells[1].textContent).toBe('座位 7');
    expect(cells[2].textContent).toBe(action === 'START' ? '开始计时' : '结束计时');
    const localDate = new Date(startLog.occurredAt);
    const localTime = [localDate.getHours(), localDate.getMinutes(), localDate.getSeconds()]
      .map((part) => String(part).padStart(2, '0')).join(':');
    expect(cells[0].textContent).toContain(String(localDate.getFullYear()));
    expect(cells[0].textContent).toContain(localTime);
    expect(cells[0].querySelector('time')?.dateTime).toBe(localDate.toISOString());
  });

  it('按 occurredAt 倒序排列，最新操作在最上方', async () => {
    const older = { ...startLog, id: 'a-older' };
    const newest = { ...startLog, id: 'z-newest', action: 'END' as const, occurredAt: startLog.occurredAt + 60_000 };
    const middle = { ...startLog, id: 'm-middle', occurredAt: startLog.occurredAt + 30_000 };
    await db.operationLogs.bulkAdd([middle, older, newest]);

    await renderLogs();

    expect(rows().map((row) => row.querySelector('time')?.dateTime)).toEqual(
      [newest, middle, older].map((log) => new Date(log.occurredAt).toISOString()),
    );
  });

  it('Seat 软删除后仍显示历史日志的原座位编号', async () => {
    await db.seats.update(seat.id, { isActive: false, updatedAt: 2 });
    await db.operationLogs.bulkAdd([
      startLog,
      { ...startLog, id: 'end-log', action: 'END', occurredAt: startLog.occurredAt + 60_000 },
    ]);

    await renderLogs();

    expect(rows()).toHaveLength(2);
    expect(rows().map((row) => row.cells[1].textContent)).toEqual(['座位 7', '座位 7']);
    expect(container.textContent).not.toContain('未知座位');
  });

  it('找不到 Seat 时显示未知座位，其他记录正常显示', async () => {
    await db.operationLogs.bulkAdd([
      startLog,
      { ...startLog, id: 'missing-seat-log', seatId: 'missing', occurredAt: startLog.occurredAt + 60_000 },
    ]);

    await renderLogs();

    expect(rows()).toHaveLength(2);
    expect(rows()[0].cells[1].textContent).toBe('未知座位');
    expect(rows()[1].cells[1].textContent).toBe('座位 7');
  });

  it('没有日志时显示空状态', async () => {
    await renderLogs();

    expect(container.querySelector('[role="status"]')?.textContent).toBe('暂无操作记录');
    expect(rows()).toHaveLength(0);
  });

  it('只读展示，不提供编辑删除控件或修改日志与 Session', async () => {
    const session: Session = {
      id: startLog.sessionId, seatId: seat.id, startedAt: startLog.occurredAt,
      endedAt: null, status: 'active', createdAt: startLog.occurredAt, updatedAt: startLog.occurredAt,
    };
    await db.sessions.add(session);
    await db.operationLogs.add(startLog);

    await renderLogs();

    expect(container.querySelector('button, input, select, textarea, [contenteditable="true"]')).toBeNull();
    expect(await db.operationLogs.toArray()).toEqual([startLog]);
    expect(await db.sessions.toArray()).toEqual([session]);
    expect(await db.seats.toArray()).toEqual([seat]);
  });

  it('新增日志后自动显示，并维持时间倒序', async () => {
    await db.operationLogs.add(startLog);
    await renderLogs();

    await act(async () => {
      await db.operationLogs.add({
        ...startLog, id: 'end-log', action: 'END', occurredAt: startLog.occurredAt + 60_000,
      });
    });

    await waitForUI(() => {
      expect(rows()).toHaveLength(2);
      expect(rows().map((row) => row.cells[2].textContent)).toEqual(['结束计时', '开始计时']);
    });
  });
});

describe('App 页面切换', () => {
  it('默认显示营业，可切换操作记录，布局编辑入口仅保留在营业页', async () => {
    await db.operationLogs.add(startLog);
    await act(async () => root.render(<App />));
    await waitForUI(() => expect(container.querySelector('[aria-label="座位 7"]')).not.toBeNull());
    expect(button('营业').getAttribute('aria-pressed')).toBe('true');
    expect(button('编辑布局')).toBeDefined();

    await act(async () => button('操作记录').click());
    await waitForUI(() => expect(rows()).toHaveLength(1));

    expect(button('操作记录').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[aria-label="店铺平面图"]')).toBeNull();
    expect(container.textContent).not.toContain('编辑布局');
    expect(container.textContent).not.toContain('添加座位');

    await act(async () => button('营业').click());
    await waitForUI(() => expect(container.querySelector('[aria-label="座位 7"]')).not.toBeNull());
    expect(button('编辑布局')).toBeDefined();
    expect(container.querySelector('table')).toBeNull();
    await act(async () => button('编辑布局').click());
    expect(button('添加座位')).toBeDefined();
    expect(button('完成编辑')).toBeDefined();
  });
});
