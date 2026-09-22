import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import { useCurrentTime } from '../../hooks/useCurrentTime';
import { formatSessionDuration } from '../../utils/sessionDuration';

function localTime(timestamp: number | null): string {
  if (timestamp === null) return '—';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '时间异常' : date.toLocaleString('zh-CN', { hour12: false });
}

export default function TodayCompletedSessions() {
  const today = new Date(useCurrentTime(true));
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const nextDayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
  const records = useLiveQuery(async () => {
    const [sessions, seats] = await Promise.all([
      db.sessions.filter((session) => session.status === 'completed'
        && session.startedAt >= dayStart && session.startedAt < nextDayStart).toArray(),
      db.seats.toArray(),
    ]);
    const seatNumbers = new Map(seats.map((seat) => [seat.id, seat.seatNumber]));
    return sessions
      .sort((a, b) => (b.endedAt ?? -Infinity) - (a.endedAt ?? -Infinity))
      .map((session) => ({ ...session, seatNumber: seatNumbers.get(session.seatId) }));
  }, [dayStart, nextDayStart]);

  return (
    <section className="today-completed" aria-labelledby="today-completed-title">
      <h2 id="today-completed-title">今日已结束</h2>
      {!records ? (
        <p role="status" className="empty-state surface">正在加载已结束记录…</p>
      ) : records.length === 0 ? (
        <p role="status" className="empty-state surface">今日暂无已结束记录</p>
      ) : (
        <div className="table-scroll surface" role="region" aria-label="今日已结束列表" tabIndex={0}>
          <table className="logs-table" aria-label="今日已结束">
            <thead>
              <tr>
                <th scope="col">座位</th>
                <th scope="col">开始时间</th>
                <th scope="col">结束时间</th>
                <th scope="col">总时长</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{record.seatNumber === undefined ? '未知座位' : `座位 ${record.seatNumber}`}</td>
                  <td>{localTime(record.startedAt)}</td>
                  <td>{localTime(record.endedAt)}</td>
                  <td>{formatSessionDuration(record)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
