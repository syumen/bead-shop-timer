import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/database';
import type { Session } from '../db/models';
import { getDailyStats, getMonthlyStats, getWeeklyStats } from './statsService';

const day = new Date(2026, 8, 21, 12, 34, 56);
const morning = new Date(2026, 8, 21, 9).getTime();
const minute = 60_000;
const emptyStats = {
  totalVisitors: 0, completedVisitors: 0, currentVisitors: 0,
  totalDurationMs: 0, averageDurationMs: 0,
};

function session(id: string, startedAt: number, endedAt: number | null = null): Session {
  return {
    id, seatId: `seat-${id}`, startedAt, endedAt,
    status: endedAt === null ? 'active' : 'completed',
    createdAt: startedAt, updatedAt: endedAt ?? startedAt,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

describe('getDailyStats', () => {
  it('没有 Session 时所有统计值为 0', async () => {
    expect(await getDailyStats(day)).toEqual(emptyStats);
  });

  it('当天 completed Session 计入接待人数、已结束人数和时长', async () => {
    await db.sessions.add(session('completed', morning, morning + 90 * minute));

    expect(await getDailyStats(day)).toEqual({
      totalVisitors: 1, completedVisitors: 1, currentVisitors: 0,
      totalDurationMs: 90 * minute, averageDurationMs: 90 * minute,
    });
  });

  it('当天 active Session 计入接待和在店人数，没有 completed 时平均时长为 0', async () => {
    await db.sessions.add(session('active', morning));

    expect(await getDailyStats(day)).toEqual({
      ...emptyStats, totalVisitors: 1, currentVisitors: 1,
    });
  });

  it('非当天开始的 Session 不计入日接待、已结束人数及日时长', async () => {
    const yesterday = new Date(2026, 8, 20, 9).getTime();
    const tomorrow = new Date(2026, 8, 22, 9).getTime();
    await db.sessions.bulkAdd([
      session('yesterday', yesterday, yesterday + 60 * minute),
      session('tomorrow', tomorrow, tomorrow + 60 * minute),
    ]);

    expect(await getDailyStats(day)).toEqual(emptyStats);
  });

  it('当前在店人数包含跨日 active Session，且不受所查询统计日期限制', async () => {
    const yesterday = new Date(2026, 8, 20, 23).getTime();
    await db.sessions.bulkAdd([session('today', morning), session('overnight', yesterday)]);

    expect(await getDailyStats(day)).toEqual({ ...emptyStats, totalVisitors: 1, currentVisitors: 2 });
    expect(await getDailyStats(new Date(2026, 8, 19))).toEqual({ ...emptyStats, currentVisitors: 2 });
  });

  it('总时长仅累加有效 completed，平均值按有效已结束次数计算，不按座位去重', async () => {
    await db.sessions.bulkAdd([
      { ...session('first', morning, morning + 90 * minute), seatId: 'same-seat' },
      { ...session('second', morning + 120 * minute, morning + 168 * minute), seatId: 'same-seat' },
      session('active', morning),
    ]);

    expect(await getDailyStats(day)).toEqual({
      totalVisitors: 3, completedVisitors: 2, currentVisitors: 1,
      totalDurationMs: 138 * minute, averageDurationMs: 69 * minute,
    });
  });

  it('平均值保留毫秒计算精度', async () => {
    await db.sessions.bulkAdd([
      session('short', morning, morning + 1),
      session('longer', morning, morning + 2),
    ]);

    expect(await getDailyStats(day)).toMatchObject({ totalDurationMs: 3, averageDurationMs: 1.5 });
  });

  it('跨午夜 completed Session 的全部时长归属于 startedAt 所在本地日期', async () => {
    const startedAt = new Date(2026, 8, 21, 23, 30).getTime();
    const endedAt = new Date(2026, 8, 22, 1).getTime();
    await db.sessions.add(session('overnight', startedAt, endedAt));

    expect(await getDailyStats(day)).toEqual({
      totalVisitors: 1, completedVisitors: 1, currentVisitors: 0,
      totalDurationMs: 90 * minute, averageDurationMs: 90 * minute,
    });
    expect(await getDailyStats(new Date(2026, 8, 22, 12))).toEqual(emptyStats);
  });

  it('日期范围包含本地零点，排除次日零点，且不修改传入日期', async () => {
    const midnight = new Date(2026, 8, 21).getTime();
    const nextMidnight = new Date(2026, 8, 22).getTime();
    await db.sessions.bulkAdd([
      session('before', midnight - 1, midnight + 999),
      session('first', midnight, midnight + 1_000),
      session('last', nextMidnight - 1, nextMidnight + 999),
      session('after', nextMidnight, nextMidnight + 1_000),
    ]);
    const originalDate = day.getTime();

    expect(await getDailyStats(day)).toEqual({
      totalVisitors: 2, completedVisitors: 2, currentVisitors: 0,
      totalDurationMs: 2_000, averageDurationMs: 1_000,
    });
    expect(day.getTime()).toBe(originalDate);
  });

  it.each([
    { label: 'endedAt 为 null', endedAt: null },
    { label: 'endedAt 早于 startedAt', endedAt: morning - minute },
  ])('1 条正常与 1 条 $label 的 completed：已结束人数为 2，平均值只按正常记录计算', async ({ endedAt }) => {
    const invalid: Session = { ...session('invalid', morning), status: 'completed', endedAt };
    const valid = session('valid', morning, morning + 60 * minute);
    await db.sessions.bulkAdd([invalid, valid]);

    expect(await getDailyStats(day)).toEqual({
      totalVisitors: 2, completedVisitors: 2, currentVisitors: 0,
      totalDurationMs: 60 * minute, averageDurationMs: 60 * minute,
    });
    expect(await db.sessions.toArray()).toEqual([invalid, valid]);
    expect(await db.operationLogs.count()).toBe(0);
  });

  it('全部 completed 都异常时，保留已结束人数且平均时长为 0', async () => {
    await db.sessions.bulkAdd([
      { ...session('missing-end', morning), status: 'completed' },
      session('negative-duration', morning, morning - minute),
    ]);

    expect(await getDailyStats(day)).toEqual({
      ...emptyStats, totalVisitors: 2, completedVisitors: 2,
    });
  });

  it('endedAt 等于 startedAt 的零时长 completed 也计入有效平均值分母', async () => {
    await db.sessions.bulkAdd([
      session('zero-duration', morning, morning),
      session('normal', morning, morning + 60 * minute),
    ]);

    expect(await getDailyStats(day)).toEqual({
      totalVisitors: 2, completedVisitors: 2, currentVisitors: 0,
      totalDurationMs: 60 * minute, averageDurationMs: 30 * minute,
    });
  });
});

describe('getMonthlyStats', () => {
  it.each([
    { label: '31 天月份', year: 2026, month: 0, lastDay: 31 },
    { label: '平年二月', year: 2026, month: 1, lastDay: 28 },
    { label: '闰年二月', year: 2028, month: 1, lastDay: 29 },
    { label: '30 天月份', year: 2026, month: 8, lastDay: 30 },
    { label: '跨年十二月', year: 2026, month: 11, lastDay: 31 },
  ])('$label：包含当月首日零点及末日最后一毫秒，排除上月和下月', async ({ year, month, lastDay }) => {
    const first = new Date(year, month, 1).getTime();
    const last = new Date(year, month, lastDay, 23, 59, 59, 999).getTime();
    const nextFirst = new Date(year, month + 1, 1).getTime();
    await db.sessions.bulkAdd([
      session('previous-month', first - 1, first + 999),
      session('first-day', first, first + 1_000),
      session('last-day', last, last + 1_000),
      session('next-month', nextFirst, nextFirst + 1_000),
    ]);
    const date = new Date(year, month, lastDay, 12, 34, 56);
    const originalDate = date.getTime();

    expect(await getMonthlyStats(date)).toEqual({
      totalVisitors: 2, completedVisitors: 2, currentVisitors: 0,
      totalDurationMs: 2_000, averageDurationMs: 1_000,
    });
    expect(date.getTime()).toBe(originalDate);
  });

  it('跨月 Session 的全部时长归属 startedAt 所在月份，不计入结束时间所在月份', async () => {
    const augustLast = new Date(2026, 7, 31, 23, 30).getTime();
    const septemberLast = new Date(2026, 8, 30, 23, 30).getTime();
    await db.sessions.bulkAdd([
      session('previous-month', augustLast, new Date(2026, 8, 1, 1).getTime()),
      session('current-month', septemberLast, new Date(2026, 9, 1, 1).getTime()),
    ]);

    expect(await getMonthlyStats(day)).toEqual({
      totalVisitors: 1, completedVisitors: 1, currentVisitors: 0,
      totalDurationMs: 90 * minute, averageDurationMs: 90 * minute,
    });
    expect(await getMonthlyStats(new Date(2026, 9, 1))).toEqual(emptyStats);
  });

  it('跨月 active 计入在店人数，总时长与平均值只使用本月有效 completed', async () => {
    const first = new Date(2026, 8, 1, 9).getTime();
    const last = new Date(2026, 8, 30, 9).getTime();
    const previousMonth = new Date(2026, 7, 31, 23).getTime();
    await db.sessions.bulkAdd([
      session('valid-first', first, first + 60 * minute),
      session('valid-last', last, last + 120 * minute),
      session('zero-duration', morning, morning),
      { ...session('missing-end', morning), status: 'completed' },
      session('negative-duration', morning, morning - minute),
      session('current-month-active', morning),
      session('previous-month-active', previousMonth),
    ]);
    const originalSessions = await db.sessions.toArray();

    expect(await getMonthlyStats(day)).toEqual({
      totalVisitors: 6, completedVisitors: 5, currentVisitors: 2,
      totalDurationMs: 180 * minute, averageDurationMs: 60 * minute,
    });
    expect(await db.sessions.toArray()).toEqual(originalSessions);
    expect(await db.operationLogs.count()).toBe(0);
  });

  it('本月 completed 全部异常时，仍计数且总时长、平均值为 0', async () => {
    await db.sessions.bulkAdd([
      { ...session('missing-end', morning), status: 'completed' },
      session('negative-duration', morning, morning - minute),
    ]);

    expect(await getMonthlyStats(day)).toEqual({
      ...emptyStats, totalVisitors: 2, completedVisitors: 2,
    });
  });

  it('没有 Session 时返回全部零值', async () => {
    expect(await getMonthlyStats(day)).toEqual(emptyStats);
  });
});

describe('getWeeklyStats', () => {
  it.each([21, 22, 23, 24, 25, 26, 27])('以 9 月 %s 日查询，包含周一零点和周日最后一毫秒，排除上周与下周', async (dayOfMonth) => {
    const monday = new Date(2026, 8, 21).getTime();
    const friday = new Date(2026, 8, 25, 12).getTime();
    const nextMonday = new Date(2026, 8, 28).getTime();
    await db.sessions.bulkAdd([
      session('previous-week', monday - 1, monday + 999),
      session('monday', monday, monday + 1_000),
      session('friday', friday, friday + 1_000),
      session('sunday', nextMonday - 1, nextMonday + 999),
      session('next-week', nextMonday, nextMonday + 1_000),
    ]);
    const date = new Date(2026, 8, dayOfMonth, 12, 34, 56);
    const originalDate = date.getTime();

    expect(await getWeeklyStats(date)).toEqual({
      totalVisitors: 3, completedVisitors: 3, currentVisitors: 0,
      totalDurationMs: 3_000, averageDurationMs: 1_000,
    });
    expect(date.getTime()).toBe(originalDate);
  });

  it('复用日统计口径：跨周 active 计入在店人数，异常 completed 不计入时长和平均值分母', async () => {
    const monday = new Date(2026, 8, 21, 9).getTime();
    const sunday = new Date(2026, 8, 27, 9).getTime();
    const previousWeek = new Date(2026, 8, 20, 23).getTime();
    await db.sessions.bulkAdd([
      session('valid-monday', monday, monday + 60 * minute),
      session('valid-sunday', sunday, sunday + 120 * minute),
      { ...session('missing-end', monday), status: 'completed' },
      session('negative-duration', sunday, sunday - minute),
      session('current-week-active', monday),
      session('previous-week-active', previousWeek),
    ]);
    const originalSessions = await db.sessions.toArray();

    expect(await getWeeklyStats(day)).toEqual({
      totalVisitors: 5, completedVisitors: 4, currentVisitors: 2,
      totalDurationMs: 180 * minute, averageDurationMs: 90 * minute,
    });
    expect(await db.sessions.toArray()).toEqual(originalSessions);
    expect(await db.operationLogs.count()).toBe(0);
  });

  it('周日跨午夜结束的完整时长按 startedAt 归属，不计入结束时间所在的新周', async () => {
    const lastSunday = new Date(2026, 8, 20, 23, 30).getTime();
    const thisSunday = new Date(2026, 8, 27, 23, 30).getTime();
    await db.sessions.bulkAdd([
      session('previous-week', lastSunday, new Date(2026, 8, 21, 1).getTime()),
      session('current-week', thisSunday, new Date(2026, 8, 28, 1).getTime()),
    ]);

    expect(await getWeeklyStats(day)).toEqual({
      totalVisitors: 1, completedVisitors: 1, currentVisitors: 0,
      totalDurationMs: 90 * minute, averageDurationMs: 90 * minute,
    });
    expect(await getWeeklyStats(new Date(2026, 8, 28))).toEqual(emptyStats);
  });

  it('本周 completed 全部异常时，已结束人数保留且平均值为 0', async () => {
    await db.sessions.bulkAdd([
      { ...session('missing-end', morning), status: 'completed' },
      session('negative-duration', morning, morning - minute),
    ]);

    expect(await getWeeklyStats(day)).toEqual({
      ...emptyStats, totalVisitors: 2, completedVisitors: 2,
    });
  });

  it('没有 Session 时返回全部零值', async () => {
    expect(await getWeeklyStats(day)).toEqual(emptyStats);
  });

  it('跨月和跨年的一周仍按本地周一到周日计算', async () => {
    const monday = new Date(2026, 11, 28).getTime();
    const nextMonday = new Date(2027, 0, 4).getTime();
    await db.sessions.bulkAdd([
      session('before', monday - 1, monday + 999),
      session('monday', monday, monday + 1_000),
      session('sunday', nextMonday - 1, nextMonday + 999),
      session('after', nextMonday, nextMonday + 1_000),
    ]);

    expect(await getWeeklyStats(new Date(2027, 0, 1, 12))).toEqual({
      totalVisitors: 2, completedVisitors: 2, currentVisitors: 0,
      totalDurationMs: 2_000, averageDurationMs: 1_000,
    });
  });
});
