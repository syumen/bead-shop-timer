import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import type { Session } from '../db/models';
import { formatSessionDuration } from '../utils/sessionDuration';

function LocalTime({ timestamp }: { timestamp: number | null }) {
  if (timestamp === null) return <>—</>;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return <>时间异常</>;
  return (
    <time dateTime={date.toISOString()}>
      {date.toLocaleTimeString('zh-CN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      })}
    </time>
  );
}

function visitorDuration(session: Session, now: number): string {
  const endedAt = session.status === 'active' ? now : session.endedAt;
  const duration = endedAt === null ? null : endedAt - session.startedAt;
  if (duration !== null && duration >= 0 && duration < 60_000) return '不足1分钟';
  return formatSessionDuration({ startedAt: session.startedAt, endedAt });
}

export default function DailyVisitorDetails({ dayStart, now }: { dayStart: number; now: number }) {
  const records = useLiveQuery(async () => {
    const nextDay = new Date(dayStart);
    nextDay.setDate(nextDay.getDate() + 1);
    // Match getDailyStats: local midnight inclusive, next local midnight exclusive,
    // with no status filter (both active and completed contribute to totalVisitors).
    const [sessions, seats] = await Promise.all([
      db.sessions.filter((session) => session.startedAt >= dayStart
        && session.startedAt < nextDay.getTime()).toArray(),
      db.seats.toArray(),
    ]);
    const seatNumbers = new Map(seats.map((seat) => [seat.id, seat.seatNumber]));
    return sessions
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((session) => ({ ...session, seatNumber: seatNumbers.get(session.seatId) }));
  }, [dayStart]);

  return (
    <section id="daily-visitor-details" aria-labelledby="daily-visitor-details-title" className="daily-visitor-details">
      <h2 id="daily-visitor-details-title">今日接待详情</h2>
      {!records ? (
        <p role="status" className="empty-state surface">正在加载接待详情…</p>
      ) : records.length === 0 ? (
        <p role="status" className="empty-state surface">今日暂无接待记录</p>
      ) : (
        <div className="table-scroll surface" role="region" aria-label="今日接待详情列表" tabIndex={0}>
          <table className="logs-table" aria-label="今日接待详情">
            <thead>
              <tr>
                <th scope="col">座位</th>
                <th scope="col">开始时间</th>
                <th scope="col">结束时间</th>
                <th scope="col">单人总时长</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{record.seatNumber === undefined ? '未知座位' : `座位 ${record.seatNumber}`}</td>
                  <td><LocalTime timestamp={record.startedAt} /></td>
                  <td>{record.status === 'active' ? '进行中' : <LocalTime timestamp={record.endedAt} />}</td>
                  <td>{visitorDuration(record, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
