import { db } from '../db/database';

export interface DailyStats {
  totalVisitors: number;
  completedVisitors: number;
  currentVisitors: number;
  totalDurationMs: number;
  averageDurationMs: number;
}

export type WeeklyStats = DailyStats;
export type MonthlyStats = DailyStats;

export async function getDailyStats(date: Date): Promise<DailyStats> {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return getStatsInRange(start, end);
}

export async function getWeeklyStats(date: Date): Promise<WeeklyStats> {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return getStatsInRange(start, end);
}

export async function getMonthlyStats(date: Date): Promise<MonthlyStats> {
  const start = new Date(date);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return getStatsInRange(start, end);
}

async function getStatsInRange(start: Date, end: Date): Promise<DailyStats> {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const sessions = await db.sessions.toArray();
  const stats: DailyStats = {
    totalVisitors: 0,
    completedVisitors: 0,
    currentVisitors: 0,
    totalDurationMs: 0,
    averageDurationMs: 0,
  };
  let validCompletedCount = 0;

  for (const session of sessions) {
    if (session.status === 'active') stats.currentVisitors += 1;
    if (!(session.startedAt >= startMs && session.startedAt < endMs)) continue;

    stats.totalVisitors += 1;
    if (session.status !== 'completed') continue;

    stats.completedVisitors += 1;
    if (session.endedAt !== null && Number.isFinite(session.endedAt)
      && session.endedAt >= session.startedAt) {
      validCompletedCount += 1;
      stats.totalDurationMs += session.endedAt - session.startedAt;
    }
  }

  if (validCompletedCount > 0) {
    stats.averageDurationMs = stats.totalDurationMs / validCompletedCount;
  }
  return stats;
}
