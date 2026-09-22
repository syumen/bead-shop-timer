// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { db } from '../db/database';
import type { Session } from '../db/models';
import { endSession, startSession } from '../services/sessionService';
import StatsPage from './StatsPage';

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
const minute = 60_000;
let now: number;
let container: HTMLDivElement;
let root: Root;

function session(id: string, startedAt: number, endedAt: number | null = null): Session {
  return {
    id, seatId: `seat-${id}`, startedAt, endedAt,
    status: endedAt === null ? 'active' : 'completed',
    createdAt: startedAt, updatedAt: endedAt ?? startedAt,
  };
}

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  now = new Date(2026, 8, 21, 12).getTime();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  await db.delete();
  await db.open();
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

async function renderStats() {
  await act(async () => root.render(<StatsPage />));
  await waitForUI(() => expect(container.querySelector('dl')).not.toBeNull());
}

function metric(label: string): string | null | undefined {
  const term = Array.from(container.querySelectorAll('dt')).find((element) => element.textContent === label);
  return term?.nextElementSibling?.textContent;
}

function button(text: string): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent === text);
  if (!element) throw new Error(`未找到按钮：${text}`);
  return element;
}

describe('StatsPage', () => {
  it('没有数据时显示五项零值，不提供日期选择或编辑控件', async () => {
    await renderStats();

    expect(metric('今日接待人数')).toBe('0人');
    expect(metric('当前在店人数')).toBe('0人');
    expect(metric('今日已结束人数')).toBe('0人');
    expect(metric('今日总拼豆时长')).toBe('0分钟');
    expect(metric('今日平均拼豆时长')).toBe('0分钟');
    expect(container.querySelector('input:not([type="file"]), select, textarea, canvas, svg')).toBeNull();
    expect(Array.from(container.querySelectorAll('[aria-label="统计周期"] button')).map((element) => element.textContent)).toEqual(['日', '周', '月']);
    expect(button('导出备份')).toBeDefined();
    expect(button('导入备份')).toBeDefined();
    expect(button('日').getAttribute('aria-pressed')).toBe('true');
  });

  it('默认按本地今天显示日统计，以小时和分钟显示时长，读取不修改数据', async () => {
    const morning = new Date(2026, 8, 21, 9).getTime();
    const yesterday = new Date(2026, 8, 20, 9).getTime();
    await db.sessions.bulkAdd([
      session('first', morning, morning + 90 * minute),
      session('second', morning, morning + 48 * minute),
      session('today-active', morning),
      session('overnight-active', yesterday),
      session('previous-completed', yesterday, yesterday + 60 * minute),
    ]);
    const originalSessions = await db.sessions.toArray();

    await renderStats();

    expect(metric('今日接待人数')).toBe('3人');
    expect(metric('当前在店人数')).toBe('2人');
    expect(metric('今日已结束人数')).toBe('2人');
    expect(metric('今日总拼豆时长')).toBe('2小时 18分钟');
    expect(metric('今日平均拼豆时长')).toBe('1小时 9分钟');
    expect(await db.sessions.toArray()).toEqual(originalSessions);
    expect(await db.operationLogs.count()).toBe(0);
  });

  it.each([
    { period: '日', prefix: '今日' },
    { period: '周', prefix: '本周' },
    { period: '月', prefix: '本月' },
  ])('$period 模式下 START 和 END 后实时更新统计，无需刷新页面', async ({ period, prefix }) => {
    await db.seats.add({
      id: 'seat-live-stats', seatNumber: 1, x: 80, y: 80, width: 64, height: 64,
      rotation: 0, isActive: true, createdAt: now, updatedAt: now,
    });
    await renderStats();
    await act(async () => button(period).click());
    await waitForUI(() => expect(metric(`${prefix}接待人数`)).toBe('0人'));
    let active!: Session;

    await act(async () => { active = await startSession('seat-live-stats'); });
    await waitForUI(() => {
      expect(metric(`${prefix}接待人数`)).toBe('1人');
      expect(metric('当前在店人数')).toBe('1人');
      expect(metric(`${prefix}已结束人数`)).toBe('0人');
      expect(metric(`${prefix}总拼豆时长`)).toBe('0分钟');
    });

    now += 18 * minute;
    await act(async () => { await endSession(active.id); });
    await waitForUI(() => {
      expect(metric(`${prefix}接待人数`)).toBe('1人');
      expect(metric('当前在店人数')).toBe('0人');
      expect(metric(`${prefix}已结束人数`)).toBe('1人');
      expect(metric(`${prefix}总拼豆时长`)).toBe('18分钟');
      expect(metric(`${prefix}平均拼豆时长`)).toBe('18分钟');
    });
    expect(await db.sessions.count()).toBe(1);
    expect(await db.operationLogs.count()).toBe(2);
  });

  it('页面跨过本地午夜后自动切换到新一天，仍保留跨日在店人数', async () => {
    now = new Date(2026, 8, 21, 23, 59, 59).getTime();
    const morning = new Date(2026, 8, 21, 9).getTime();
    await db.sessions.bulkAdd([
      session('completed', morning, morning + 60 * minute),
      session('overnight-active', now),
    ]);
    await renderStats();
    expect(metric('今日接待人数')).toBe('2人');
    expect(metric('今日已结束人数')).toBe('1人');

    now = new Date(2026, 8, 22).getTime();

    await waitForUI(() => {
      expect(metric('今日接待人数')).toBe('0人');
      expect(metric('今日已结束人数')).toBe('0人');
      expect(metric('当前在店人数')).toBe('1人');
      expect(metric('今日总拼豆时长')).toBe('0分钟');
    });
  });

  it('默认日模式，日、周、月切换更新五项指标，切回日模式恢复当天数据', async () => {
    now = new Date(2026, 8, 23, 12).getTime();
    const morning = new Date(2026, 8, 23, 9).getTime();
    const monday = new Date(2026, 8, 21, 9).getTime();
    const previousSunday = new Date(2026, 8, 20, 23).getTime();
    const earlierInMonth = new Date(2026, 8, 5, 9).getTime();
    const previousMonth = new Date(2026, 7, 31, 23).getTime();
    await db.sessions.bulkAdd([
      session('today-completed', morning, morning + 30 * minute),
      session('monday-completed', monday, monday + 60 * minute),
      session('earlier-month-completed', earlierInMonth, earlierInMonth + 90 * minute),
      session('today-active', morning),
      session('previous-week-active', previousSunday),
      session('previous-month-active', previousMonth),
    ]);
    await renderStats();
    expect(button('日').getAttribute('aria-pressed')).toBe('true');
    expect(metric('今日接待人数')).toBe('2人');
    expect(metric('今日已结束人数')).toBe('1人');
    expect(metric('今日总拼豆时长')).toBe('30分钟');
    expect(metric('今日平均拼豆时长')).toBe('30分钟');

    await act(async () => button('周').click());
    await waitForUI(() => {
      expect(metric('本周接待人数')).toBe('3人');
      expect(metric('当前在店人数')).toBe('3人');
      expect(metric('本周已结束人数')).toBe('2人');
      expect(metric('本周总拼豆时长')).toBe('1小时 30分钟');
      expect(metric('本周平均拼豆时长')).toBe('45分钟');
    });
    expect(button('周').getAttribute('aria-pressed')).toBe('true');
    expect(button('日').getAttribute('aria-pressed')).toBe('false');
    expect(metric('今日接待人数')).toBeUndefined();

    await act(async () => button('月').click());
    await waitForUI(() => {
      expect(metric('本月接待人数')).toBe('5人');
      expect(metric('当前在店人数')).toBe('3人');
      expect(metric('本月已结束人数')).toBe('3人');
      expect(metric('本月总拼豆时长')).toBe('3小时 0分钟');
      expect(metric('本月平均拼豆时长')).toBe('1小时 0分钟');
    });
    expect(button('月').getAttribute('aria-pressed')).toBe('true');
    expect(button('周').getAttribute('aria-pressed')).toBe('false');
    expect(metric('本周接待人数')).toBeUndefined();

    await act(async () => button('日').click());
    await waitForUI(() => {
      expect(metric('今日接待人数')).toBe('2人');
      expect(metric('当前在店人数')).toBe('3人');
      expect(metric('今日已结束人数')).toBe('1人');
      expect(metric('今日总拼豆时长')).toBe('30分钟');
      expect(metric('今日平均拼豆时长')).toBe('30分钟');
    });
    expect(metric('本周接待人数')).toBeUndefined();
    expect(metric('本月接待人数')).toBeUndefined();
    expect(button('日').getAttribute('aria-pressed')).toBe('true');
    expect(button('月').getAttribute('aria-pressed')).toBe('false');
  });

  it('周模式跨过周日午夜后切换到新周，保留跨周在店人数', async () => {
    now = new Date(2026, 8, 27, 23, 59, 59).getTime();
    const monday = new Date(2026, 8, 21, 9).getTime();
    await db.sessions.bulkAdd([
      session('completed', monday, monday + 60 * minute),
      session('cross-week-active', now),
    ]);
    await renderStats();
    await act(async () => button('周').click());
    await waitForUI(() => {
      expect(metric('本周接待人数')).toBe('2人');
      expect(metric('本周已结束人数')).toBe('1人');
    });

    now = new Date(2026, 8, 28).getTime();

    await waitForUI(() => {
      expect(metric('本周接待人数')).toBe('0人');
      expect(metric('本周已结束人数')).toBe('0人');
      expect(metric('当前在店人数')).toBe('1人');
      expect(metric('本周总拼豆时长')).toBe('0分钟');
      expect(metric('本周平均拼豆时长')).toBe('0分钟');
    });
  });

  it('月模式跨过月末午夜后切换到新月，保留跨月在店人数', async () => {
    now = new Date(2026, 8, 30, 23, 59, 59).getTime();
    const first = new Date(2026, 8, 1, 9).getTime();
    await db.sessions.bulkAdd([
      session('completed', first, first + 60 * minute),
      session('cross-month-active', now),
    ]);
    await renderStats();
    await act(async () => button('月').click());
    await waitForUI(() => {
      expect(metric('本月接待人数')).toBe('2人');
      expect(metric('本月已结束人数')).toBe('1人');
    });

    now = new Date(2026, 9, 1).getTime();

    await waitForUI(() => {
      expect(metric('本月接待人数')).toBe('0人');
      expect(metric('本月已结束人数')).toBe('0人');
      expect(metric('当前在店人数')).toBe('1人');
      expect(metric('本月总拼豆时长')).toBe('0分钟');
      expect(metric('本月平均拼豆时长')).toBe('0分钟');
    });
  });
});

describe('经营统计页面切换', () => {
  it('可以在营业、操作记录和经营统计之间切换，营业页保留编辑入口', async () => {
    await act(async () => root.render(<App />));
    expect(button('营业').getAttribute('aria-pressed')).toBe('true');

    await act(async () => button('经营统计').click());
    await waitForUI(() => expect(metric('今日接待人数')).toBe('0人'));
    expect(button('经营统计').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[aria-label="店铺平面图"]')).toBeNull();

    await act(async () => button('操作记录').click());
    await waitForUI(() => expect(container.textContent).toContain('暂无操作记录'));
    expect(container.querySelector('dl')).toBeNull();

    await act(async () => button('营业').click());
    expect(container.querySelector('[aria-label="店铺平面图"]')).not.toBeNull();
    expect(button('编辑布局')).toBeDefined();
  });
});

function detailRows(): HTMLTableRowElement[] {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>('[aria-label="今日接待详情"] tbody tr'));
}

async function openDetails() {
  await act(async () => button('今日接待人数').click());
  await waitForUI(() => expect(container.textContent).not.toContain('正在加载接待详情…'));
}

async function addDetailSeat(id: string, seatNumber: number, isActive = true) {
  await db.seats.add({
    id, seatNumber, isActive, x: 80, y: 80, width: 64, height: 64, rotation: 0,
    createdAt: now, updatedAt: now,
  });
}

describe('今日接待详情', () => {
  it('点击卡片展开和收起，空状态位于统计卡片下方', async () => {
    await renderStats();
    expect(button('今日接待人数').getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#daily-visitor-details')).toBeNull();

    await openDetails();

    expect(button('今日接待人数').getAttribute('aria-expanded')).toBe('true');
    expect(button('今日接待人数').getAttribute('aria-controls')).toBe('daily-visitor-details');
    expect(container.querySelector('.stats-grid')?.nextElementSibling?.id).toBe('daily-visitor-details');
    expect(container.textContent).toContain('今日暂无接待记录');
    await act(async () => button('今日接待人数').click());
    expect(container.querySelector('#daily-visitor-details')).toBeNull();
    expect(button('今日接待人数').getAttribute('aria-expanded')).toBe('false');
  });

  it.each([
    { minutes: 38, expected: '38分钟', endText: '09:40:02' },
    { minutes: 106, expected: '1小时 46分钟', endText: '10:48:02' },
  ])('completed 显示本地 HH:mm:ss 及固定总时长 $expected', async ({ minutes, expected, endText }) => {
    const startedAt = new Date(2026, 8, 21, 9, 1, 3).getTime();
    const endedAt = startedAt + minutes * minute + 59_000;
    await addDetailSeat('seat-finished', 8);
    await db.sessions.add(session('finished', startedAt, endedAt));
    await renderStats();
    await openDetails();

    expect(detailRows()).toHaveLength(1);
    expect(Array.from(detailRows()[0].cells).map((cell) => cell.textContent)).toEqual([
      '座位 8', '09:01:03', endText, expected,
    ]);
    expect(Array.from(detailRows()[0].querySelectorAll('time')).map((time) => time.dateTime)).toEqual([
      new Date(startedAt).toISOString(), new Date(endedAt).toISOString(),
    ]);
  });

  it('active 显示进行中，按当前时间自动更新时长，completed 时长固定且不写数据库', async () => {
    const active = session('active-detail', now - 38 * minute);
    const completed = session('completed-detail', now - 120 * minute, now - 14 * minute);
    await db.sessions.bulkAdd([completed, active]);
    await db.operationLogs.add({ id: 'start', sessionId: active.id, seatId: active.seatId, action: 'START', occurredAt: active.startedAt });
    const originals = await db.sessions.toArray();
    const logs = await db.operationLogs.toArray();
    await renderStats();
    await openDetails();
    expect(detailRows()[0].cells[2].textContent).toBe('进行中');
    expect(detailRows()[0].cells[3].textContent).toBe('38分钟');
    expect(detailRows()[1].cells[3].textContent).toBe('1小时 46分钟');

    now += minute;
    await waitForUI(() => expect(detailRows()[0].cells[3].textContent).toBe('39分钟'));
    expect(detailRows()[1].cells[3].textContent).toBe('1小时 46分钟');
    expect(await db.sessions.toArray()).toEqual(originals);
    expect(await db.operationLogs.toArray()).toEqual(logs);
  });

  it('软删除座位仍显示原编号，找不到 Seat 时显示未知座位', async () => {
    await addDetailSeat('seat-deleted', 12, false);
    await db.sessions.bulkAdd([
      session('deleted', now - 10 * minute, now - minute),
      session('missing', now - 5 * minute),
    ]);
    await renderStats();
    await openDetails();
    expect(detailRows().map((row) => row.cells[0].textContent)).toEqual(['未知座位', '座位 12']);
  });

  it('明细数量与 totalVisitors 相同，包含今天所有状态和边界内记录，排除非今日 startedAt', async () => {
    const dayStart = new Date(2026, 8, 21).getTime();
    const nextDayStart = new Date(2026, 8, 22).getTime();
    const included = [
      session('midnight', dayStart, dayStart + minute),
      session('active', now - minute),
      session('cross-midnight', nextDayStart - 1, nextDayStart + minute),
      { ...session('invalid-completed', now - 2 * minute), status: 'completed' as const },
    ];
    await db.sessions.bulkAdd([
      ...included,
      session('yesterday', dayStart - 1, dayStart + minute),
      session('yesterday-active', dayStart - 2 * minute),
      session('tomorrow', nextDayStart, nextDayStart + minute),
    ]);
    await renderStats();
    await openDetails();

    expect(metric('今日接待人数')).toBe(`${included.length}人`);
    expect(detailRows()).toHaveLength(included.length);
    expect(detailRows().map((row) => row.cells[1].querySelector('time')?.dateTime)).toEqual(
      [...included].sort((a, b) => b.startedAt - a.startedAt).map((item) => new Date(item.startedAt).toISOString()),
    );
    const invalidRow = detailRows().find((row) => row.cells[2].textContent === '—');
    expect(invalidRow?.cells[3].textContent).toBe('时长异常');
    expect(detailRows().at(-1)?.cells[1].textContent).toBe('00:00:00');
  });

  it('按 startedAt 倒序，而非 endedAt 或记录 ID 排序', async () => {
    const older = session('z-old', now - 60 * minute, now);
    const middle = session('a-middle', now - 30 * minute, now - 15 * minute);
    const newest = session('m-new', now - 10 * minute);
    await db.sessions.bulkAdd([newest, older, middle]);
    await renderStats();
    await openDetails();
    expect(detailRows().map((row) => row.cells[1].querySelector('time')?.dateTime)).toEqual(
      [newest, middle, older].map((item) => new Date(item.startedAt).toISOString()),
    );
  });

  it.each(['周', '月'])('切到%s模式关闭详情且无详情入口，返回日模式保持收起', async (period) => {
    await renderStats();
    await openDetails();
    await act(async () => button(period).click());
    await waitForUI(() => expect(container.textContent).toContain(period === '周' ? '本周接待人数' : '本月接待人数'));
    expect(container.querySelector('#daily-visitor-details')).toBeNull();
    expect(container.querySelector('.stats-card button')).toBeNull();
    await act(async () => button('日').click());
    await waitForUI(() => expect(metric('今日接待人数')).toBe('0人'));
    expect(button('今日接待人数').getAttribute('aria-expanded')).toBe('false');
  });

  it('展开后 START 和 END 自动更新明细，不足一分钟显示提示，END 后固定最终时长', async () => {
    await addDetailSeat('seat-live-detail', 3);
    await renderStats();
    await openDetails();
    let active!: Session;
    await act(async () => { active = await startSession('seat-live-detail'); });
    await waitForUI(() => {
      expect(metric('今日接待人数')).toBe('1人');
      expect(detailRows()[0]?.cells[2].textContent).toBe('进行中');
      expect(detailRows()[0]?.cells[3].textContent).toBe('不足1分钟');
    });

    now += 38 * minute;
    const endedAt = now;
    await act(async () => { await endSession(active.id); });
    await waitForUI(() => {
      expect(detailRows()[0].cells[2].querySelector('time')?.dateTime).toBe(new Date(endedAt).toISOString());
      expect(detailRows()[0].cells[3].textContent).toBe('38分钟');
      expect(metric('今日接待人数')).toBe('1人');
    });
    expect(await db.operationLogs.count()).toBe(2);
  });

  it('跨本地午夜时明细与今日接待人数同时切换到新一天', async () => {
    now = new Date(2026, 8, 21, 23, 59, 59).getTime();
    await db.sessions.add(session('overnight', now - 10 * minute));
    await renderStats();
    await openDetails();
    expect(detailRows()).toHaveLength(1);
    now = new Date(2026, 8, 22).getTime();
    await waitForUI(() => {
      expect(metric('今日接待人数')).toBe('0人');
      expect(container.textContent).toContain('今日暂无接待记录');
      expect(detailRows()).toHaveLength(0);
    });
    expect(await db.sessions.count()).toBe(1);
  });
});
