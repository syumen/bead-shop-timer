import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import DataManagement from '../components/DataManagement';
import { useCurrentTime } from '../hooks/useCurrentTime';
import { getDailyStats, getMonthlyStats, getWeeklyStats } from '../services/statsService';

const statsPeriods = {
  daily: { label: '今日', getStats: getDailyStats },
  weekly: { label: '本周', getStats: getWeeklyStats },
  monthly: { label: '本月', getStats: getMonthlyStats },
};

function formatDuration(durationMs: number): string {
  const totalMinutes = Math.floor(durationMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}小时 ${minutes}分钟` : `${minutes}分钟`;
}

export default function StatsPage() {
  const [period, setPeriod] = useState<keyof typeof statsPeriods>('daily');
  const today = new Date(useCurrentTime(true));
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const { label: periodLabel, getStats } = statsPeriods[period];
  const stats = useLiveQuery(
    () => getStats(new Date(dayStart)),
    [dayStart, period],
  );

  return (
    <main className="page">
      <header className="page-heading">
        <h1>经营统计</h1>
        <div role="group" aria-label="统计周期" className="period-switch">
          <button type="button" aria-pressed={period === 'daily'} onClick={() => setPeriod('daily')}>
            日
          </button>
          <button type="button" aria-pressed={period === 'weekly'} onClick={() => setPeriod('weekly')}>
            周
          </button>
          <button type="button" aria-pressed={period === 'monthly'} onClick={() => setPeriod('monthly')}>
            月
          </button>
        </div>
      </header>
      {!stats ? (
        <p role="status" className="empty-state surface">正在加载经营统计…</p>
      ) : (
        <dl className="stats-grid">
          <div className="stats-card">
            <dt>{periodLabel}接待人数</dt>
            <dd>{stats.totalVisitors}人</dd>
          </div>
          <div className="stats-card">
            <dt>当前在店人数</dt>
            <dd>{stats.currentVisitors}人</dd>
          </div>
          <div className="stats-card">
            <dt>{periodLabel}已结束人数</dt>
            <dd>{stats.completedVisitors}人</dd>
          </div>
          <div className="stats-card stats-card-duration">
            <dt>{periodLabel}总拼豆时长</dt>
            <dd>{formatDuration(stats.totalDurationMs)}</dd>
          </div>
          <div className="stats-card stats-card-duration">
            <dt>{periodLabel}平均拼豆时长</dt>
            <dd>{formatDuration(stats.averageDurationMs)}</dd>
          </div>
        </dl>
      )}
      <DataManagement />
    </main>
  );
}
