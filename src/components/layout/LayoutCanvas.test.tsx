// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/database';
import type { Seat } from '../../db/models';
import * as sessionService from '../../services/sessionService';
import LayoutCanvas from './LayoutCanvas';

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
const seat: Seat = {
  id: 'seat-start-test', seatNumber: 1, x: 80, y: 80, width: 64, height: 64,
  rotation: 0, isActive: true, createdAt: 1, updatedAt: 1,
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
  vi.restoreAllMocks();
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

async function renderLayout() {
  await act(async () => root.render(<LayoutCanvas />));
  await waitForUI(() => expect(container.querySelector('[aria-label="座位 1"]')).not.toBeNull());
}

function seatElement(seatNumber = 1): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[aria-label="座位 ${seatNumber}"]`);
  if (!element) throw new Error('未找到座位');
  return element;
}

function button(text: string): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === text);
  if (!element) throw new Error(`未找到按钮：${text}`);
  return element;
}

function panel(): HTMLElement | null {
  return container.querySelector('[role="dialog"]');
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

describe('营业模式单座位 START', () => {
  it('点击空闲座位打开确认面板，尚不调用 startSession', async () => {
    const start = vi.spyOn(sessionService, 'startSession');
    await renderLayout();

    await click(seatElement());

    expect(panel()?.textContent).toContain('座位 1');
    expect(panel()?.textContent).toContain('当前状态：空闲');
    expect(button('开始计时').disabled).toBe(false);
    expect(button('取消').disabled).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(await db.sessions.count()).toBe(0);
    expect(await db.operationLogs.count()).toBe(0);
  });

  it('确认后直接调用 startSession，成功关闭面板并显示 active 计时，无需刷新', async () => {
    const start = vi.spyOn(sessionService, 'startSession');
    await renderLayout();
    expect(container.querySelector('[aria-label="当前在店人数"]')?.textContent).toContain('0人');
    await click(seatElement());

    await click(button('开始计时'));
    await waitForUI(() => {
      expect(panel()).toBeNull();
      expect(seatElement().textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
      expect(seatElement().textContent).not.toContain('空闲');
      expect(container.querySelector('[aria-label="当前在店人数"]')?.textContent).toContain('1人');
    });

    expect(start).toHaveBeenCalledExactlyOnceWith(seat.id);
    expect(await db.sessions.count()).toBe(1);
    expect((await db.sessions.toArray())[0]).toMatchObject({ seatId: seat.id, status: 'active' });
    expect(await db.operationLogs.count()).toBe(1);
    expect((await db.operationLogs.toArray())[0].action).toBe('START');
  });

  it('取消只关闭面板，不调用服务或创建数据', async () => {
    const start = vi.spyOn(sessionService, 'startSession');
    await renderLayout();
    await click(seatElement());

    await click(button('取消'));

    expect(panel()).toBeNull();
    expect(start).not.toHaveBeenCalled();
    expect(await db.sessions.count()).toBe(0);
    expect(await db.operationLogs.count()).toBe(0);
  });

  it('服务失败时显示原始错误并保留面板，不创建额外数据', async () => {
    const start = vi.spyOn(sessionService, 'startSession')
      .mockRejectedValueOnce(new Error('测试：开始计时失败'));
    await renderLayout();
    await click(seatElement());

    await click(button('开始计时'));

    expect(panel()?.querySelector('[role="alert"]')?.textContent).toBe('测试：开始计时失败');
    expect(panel()).not.toBeNull();
    expect(button('开始计时').disabled).toBe(false);
    expect(start).toHaveBeenCalledExactlyOnceWith(seat.id);
    expect(await db.sessions.count()).toBe(0);
    expect(await db.operationLogs.count()).toBe(0);
  });

  it('已有 active Session 的座位不提供 START 入口', async () => {
    await sessionService.startSession(seat.id);
    const start = vi.spyOn(sessionService, 'startSession');
    await renderLayout();

    await click(seatElement());

    expect(seatElement().getAttribute('role')).toBe('button');
    expect(panel()?.textContent).toContain('结束计时');
    expect(container.textContent).not.toContain('开始计时');
    expect(start).not.toHaveBeenCalled();
    expect(await db.sessions.count()).toBe(1);
    expect(await db.operationLogs.count()).toBe(1);
  });

  it('进入编辑模式会关闭面板，点击座位不再触发 START', async () => {
    const start = vi.spyOn(sessionService, 'startSession');
    await renderLayout();
    await click(seatElement());

    await click(button('编辑布局'));
    await click(seatElement());

    expect(panel()).toBeNull();
    expect(seatElement().getAttribute('role')).not.toBe('button');
    expect(seatElement().querySelector('[aria-label="删除座位 1"]')).not.toBeNull();
    expect(container.textContent).toContain('正在编辑布局');
    const toolbar = container.querySelector('[aria-label="布局工具栏"]');
    expect(toolbar?.contains(button('添加座位'))).toBe(true);
    expect(toolbar?.contains(button('添加桌子'))).toBe(true);
    expect(toolbar?.contains(button('完成编辑'))).toBe(true);
    expect(start).not.toHaveBeenCalled();
    expect(await db.sessions.count()).toBe(0);
  });

  it('连续确认只提交一次，等待服务期间禁用开始、取消和模式切换', async () => {
    const realStart = sessionService.startSession;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const start = vi.spyOn(sessionService, 'startSession').mockImplementationOnce(async (id) => {
      await gate;
      return realStart(id);
    });
    await renderLayout();
    await click(seatElement());
    const confirm = button('开始计时');

    try {
      await act(async () => {
        confirm.click();
        confirm.click();
      });

      expect(start).toHaveBeenCalledExactlyOnceWith(seat.id);
      expect(button('正在开始…').disabled).toBe(true);
      expect(button('取消').disabled).toBe(true);
      expect(button('编辑布局').disabled).toBe(true);
      expect(await db.sessions.count()).toBe(0);
    } finally {
      await act(async () => {
        release();
        await start.mock.results[0]?.value;
      });
    }

    await waitForUI(() => expect(panel()).toBeNull());
    expect(await db.sessions.count()).toBe(1);
    expect(await db.operationLogs.count()).toBe(1);
  });

  it('面板打开期间出现 active Session 时移除开始按钮，不能再次 START', async () => {
    await renderLayout();
    await click(seatElement());

    await act(async () => { await sessionService.startSession(seat.id); });
    await waitForUI(() => {
      expect(panel()?.textContent).toContain('当前状态：计时中');
      expect(panel()?.textContent).not.toContain('开始计时');
    });
    const start = vi.spyOn(sessionService, 'startSession');
    await click(seatElement());

    expect(start).not.toHaveBeenCalled();
    expect(await db.sessions.count()).toBe(1);
    expect(await db.operationLogs.count()).toBe(1);
  });

  it('空闲座位支持键盘打开确认面板，但不会直接开始', async () => {
    const start = vi.spyOn(sessionService, 'startSession');
    await renderLayout();

    await act(async () => {
      seatElement().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(panel()).not.toBeNull();
    expect(start).not.toHaveBeenCalled();
  });
});

describe('营业模式单座位 END', () => {
  it('点击 active 座位显示对应座位、开始时间和已用时，不立即结束', async () => {
    const startedAt = 1_700_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
    await sessionService.startSession(seat.id);
    const secondSeat = { ...seat, id: 'seat-end-test-2', seatNumber: 2, x: 160 };
    await db.seats.add(secondSeat);
    clock.mockReturnValue(startedAt + 60_000);
    const session = await sessionService.startSession(secondSeat.id);
    clock.mockReturnValue(startedAt + 3_661_000);
    const end = vi.spyOn(sessionService, 'endSession');
    await renderLayout();

    await click(seatElement(2));

    expect(panel()?.querySelector('h2')?.textContent).toBe('座位 2');
    expect(panel()?.textContent).toContain('开始时间：');
    expect(panel()?.querySelector('time')?.dateTime).toBe(new Date(session.startedAt).toISOString());
    expect(panel()?.querySelector('time')?.textContent).toBe(
      new Date(session.startedAt).toLocaleString('zh-CN', { hour12: false }),
    );
    expect(panel()?.textContent).toContain('当前已用时：01:00:01');
    expect(button('结束计时').disabled).toBe(false);
    expect(button('关闭').disabled).toBe(false);
    expect(panel()?.textContent).not.toContain('开始计时');
    expect(end).not.toHaveBeenCalled();
  });

  it('详情已用时随时钟刷新，不写入 Session 或日志', async () => {
    const startedAt = 1_700_000_000_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
    const session = await sessionService.startSession(seat.id);
    const logs = await db.operationLogs.toArray();
    clock.mockReturnValue(startedAt + 5_000);
    await renderLayout();
    await click(seatElement());
    expect(panel()?.textContent).toContain('当前已用时：00:00:05');

    clock.mockReturnValue(startedAt + 6_000);
    await waitForUI(() => {
      expect(panel()?.textContent).toContain('当前已用时：00:00:06');
      expect(seatElement().textContent).toContain('00:00:06');
    });

    expect(await db.sessions.get(session.id)).toEqual(session);
    expect(await db.operationLogs.toArray()).toEqual(logs);
  });

  it('第一次点击结束计时仅进入明确的二次确认，不调用 endSession', async () => {
    const session = await sessionService.startSession(seat.id);
    const end = vi.spyOn(sessionService, 'endSession');
    await renderLayout();
    await click(seatElement());

    await click(button('结束计时'));

    expect(panel()?.textContent).toContain('确认结束座位 1 的计时？');
    expect(button('确认结束').disabled).toBe(false);
    expect(button('取消').disabled).toBe(false);
    expect(end).not.toHaveBeenCalled();
    expect(await db.sessions.get(session.id)).toEqual(session);
    expect(await db.operationLogs.count()).toBe(1);
  });

  it('取消二次确认返回详情，不结束 Session 或新增日志', async () => {
    const session = await sessionService.startSession(seat.id);
    const end = vi.spyOn(sessionService, 'endSession');
    await renderLayout();
    await click(seatElement());
    await click(button('结束计时'));

    await click(button('取消'));

    expect(panel()).not.toBeNull();
    expect(panel()?.textContent).not.toContain('确认结束');
    expect(button('结束计时').disabled).toBe(false);
    expect(end).not.toHaveBeenCalled();
    expect(await db.sessions.get(session.id)).toEqual(session);
    expect(await db.operationLogs.count()).toBe(1);
  });

  it('关闭详情不会结束计时', async () => {
    const session = await sessionService.startSession(seat.id);
    const end = vi.spyOn(sessionService, 'endSession');
    await renderLayout();
    await click(seatElement());

    await click(button('关闭'));

    expect(panel()).toBeNull();
    expect(end).not.toHaveBeenCalled();
    expect(await db.sessions.get(session.id)).toEqual(session);
    expect(await db.operationLogs.count()).toBe(1);
  });

  it.each([
    { minutes: 38, duration: '38分钟' },
    { minutes: 106, duration: '1小时 46分钟' },
  ])('END 后保留结果，显示 $duration，完成后才关闭并可重新 START', async ({ minutes, duration }) => {
    const startedAt = new Date(2026, 8, 22, 9).getTime();
    const endedAt = startedAt + minutes * 60_000 + 59_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(startedAt);
    const session = await sessionService.startSession(seat.id);
    const end = vi.spyOn(sessionService, 'endSession');
    await renderLayout();
    await click(seatElement());
    await click(button('结束计时'));

    clock.mockReturnValue(endedAt);
    await click(button('确认结束'));
    await waitForUI(() => {
      expect(panel()?.textContent).toContain(`本次总时长：${duration}`);
      expect(seatElement().textContent).toContain('空闲');
      expect(seatElement().textContent).not.toMatch(/\d{2}:\d{2}:\d{2}/);
      expect(container.querySelector('[aria-label="当前在店人数"]')?.textContent).toContain('0人');
      expect(container.querySelector('[aria-label="今日已结束"] tbody')?.textContent).toContain(duration);
    });

    expect(panel()?.querySelector('h2')?.textContent).toBe('座位 1');
    expect(Array.from(panel()!.querySelectorAll('time')).map((time) => time.dateTime)).toEqual([
      new Date(startedAt).toISOString(), new Date(endedAt).toISOString(),
    ]);
    expect(panel()?.textContent).not.toContain('确认结束');
    expect(panel()?.textContent).not.toContain('当前已用时');
    expect(Array.from(panel()!.querySelectorAll('button')).map((item) => item.textContent)).toEqual(['完成']);
    expect(end).toHaveBeenCalledExactlyOnceWith(session.id);
    expect(await db.sessions.get(session.id)).toMatchObject({ status: 'completed', endedAt: expect.any(Number) });
    expect(await db.operationLogs.filter((log) => log.action === 'END').count()).toBe(1);
    const completed = await db.sessions.get(session.id);
    await click(button('完成'));
    expect(panel()).toBeNull();
    expect(await db.sessions.get(session.id)).toEqual(completed);
    expect(await db.operationLogs.count()).toBe(2);
    await click(seatElement());
    expect(panel()?.textContent).toContain('当前状态：空闲');
    expect(button('开始计时').disabled).toBe(false);
    expect(panel()?.textContent).not.toContain('结束计时');
  });

  it('提交期间重复确认只调用一次服务，只产生一条 END 日志', async () => {
    const session = await sessionService.startSession(seat.id);
    const realEnd = sessionService.endSession;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const end = vi.spyOn(sessionService, 'endSession').mockImplementationOnce(async (id) => {
      await gate;
      return realEnd(id);
    });
    await renderLayout();
    await click(seatElement());
    await click(button('结束计时'));
    const confirm = button('确认结束');

    try {
      await act(async () => {
        confirm.click();
        confirm.click();
      });
      await click(seatElement());
      await click(button('编辑布局'));

      expect(end).toHaveBeenCalledExactlyOnceWith(session.id);
      expect(button('正在结束…').disabled).toBe(true);
      expect(button('取消').disabled).toBe(true);
      expect(button('编辑布局').disabled).toBe(true);
      expect(await db.sessions.get(session.id)).toEqual(session);
      expect(await db.operationLogs.count()).toBe(1);
    } finally {
      await act(async () => {
        release();
        await end.mock.results[0]?.value;
      });
    }

    await waitForUI(() => {
      expect(panel()?.textContent).toContain('本次总时长：');
      expect(seatElement().textContent).toContain('空闲');
    });
    expect(end).toHaveBeenCalledTimes(1);
    expect(await db.operationLogs.filter((log) => log.action === 'END').count()).toBe(1);
  });

  it('END 失败保留确认界面并显示原始错误，不自行修改数据库', async () => {
    const session = await sessionService.startSession(seat.id);
    const logs = await db.operationLogs.toArray();
    const end = vi.spyOn(sessionService, 'endSession')
      .mockRejectedValueOnce(new Error('测试：结束计时失败'));
    await renderLayout();
    await click(seatElement());
    await click(button('结束计时'));

    await click(button('确认结束'));

    expect(end).toHaveBeenCalledExactlyOnceWith(session.id);
    expect(panel()?.querySelector('[role="alert"]')?.textContent).toBe('测试：结束计时失败');
    expect(panel()?.textContent).toContain('确认结束座位 1 的计时？');
    expect(button('确认结束').disabled).toBe(false);
    expect(seatElement().textContent).not.toContain('空闲');
    expect(await db.sessions.get(session.id)).toEqual(session);
    expect(await db.operationLogs.toArray()).toEqual(logs);
  });

  it('进入编辑模式关闭 END 面板，点击 active 座位不触发 START 或 END', async () => {
    const session = await sessionService.startSession(seat.id);
    const start = vi.spyOn(sessionService, 'startSession');
    const end = vi.spyOn(sessionService, 'endSession');
    await renderLayout();
    await click(seatElement());
    await click(button('结束计时'));

    await click(button('编辑布局'));
    await click(seatElement());

    expect(panel()).toBeNull();
    expect(seatElement().getAttribute('role')).not.toBe('button');
    expect(seatElement().querySelector('[aria-label="删除座位 1"]')).not.toBeNull();
    expect(container.textContent).not.toContain('结束计时');
    expect(start).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    expect(await db.sessions.get(session.id)).toEqual(session);
    expect(await db.operationLogs.count()).toBe(1);
  });

  it('切换 active 座位后需重新确认，仅结束当前选择的 Session', async () => {
    const first = await sessionService.startSession(seat.id);
    const secondSeat = { ...seat, id: 'seat-end-test-2', seatNumber: 2, x: 160 };
    await db.seats.add(secondSeat);
    const second = await sessionService.startSession(secondSeat.id);
    const end = vi.spyOn(sessionService, 'endSession');
    await renderLayout();
    await click(seatElement());
    await click(button('结束计时'));

    await click(seatElement(2));

    expect(panel()?.querySelector('h2')?.textContent).toBe('座位 2');
    expect(panel()?.textContent).not.toContain('确认结束');
    expect(end).not.toHaveBeenCalled();
    await click(button('结束计时'));
    expect(panel()?.textContent).toContain('确认结束座位 2 的计时？');
    await click(button('确认结束'));
    await waitForUI(() => expect(seatElement(2).textContent).toContain('空闲'));
    expect(end).toHaveBeenCalledExactlyOnceWith(second.id);
    expect(await db.sessions.get(first.id)).toEqual(first);
  });

  it('已打开的 Session 被外部结束并重新开始时，不把旧确认用于新 Session', async () => {
    const first = await sessionService.startSession(seat.id);
    await renderLayout();
    await click(seatElement());
    await click(button('结束计时'));

    await act(async () => {
      await sessionService.endSession(first.id);
      await sessionService.startSession(seat.id);
    });
    await waitForUI(() => {
      expect(panel()).toBeNull();
      // The live query may emit the idle state between END and the next START.
      expect(seatElement().textContent).not.toContain('空闲');
    });
    const end = vi.spyOn(sessionService, 'endSession');
    await click(seatElement());

    expect(panel()?.textContent).not.toContain('确认结束');
    expect(button('结束计时').disabled).toBe(false);
    expect(end).not.toHaveBeenCalled();
    expect(await db.sessions.filter((session) => session.status === 'active').count()).toBe(1);
    expect(await db.operationLogs.filter((log) => log.action === 'END').count()).toBe(1);
  });
});
