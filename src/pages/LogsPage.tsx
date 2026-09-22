import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';

export default function LogsPage() {
  const records = useLiveQuery(async () => {
    const [logs, seats] = await Promise.all([
      db.operationLogs.toArray(),
      db.seats.toArray(),
    ]);
    const seatNumbers = new Map(seats.map((seat) => [seat.id, seat.seatNumber]));

    return logs
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .map((log) => ({ ...log, seatNumber: seatNumbers.get(log.seatId) }));
  }, []);

  return (
    <main className="page">
      <header className="page-heading"><h1>操作记录</h1></header>
      {!records ? (
        <p role="status" className="empty-state surface">正在加载操作记录…</p>
      ) : records.length === 0 ? (
        <p role="status" className="empty-state surface">暂无操作记录</p>
      ) : (
        <div className="table-scroll surface" role="region" aria-label="操作记录列表" tabIndex={0}>
          <table aria-label="操作记录" className="logs-table">
            <thead>
              <tr>
                <th scope="col">时间</th>
                <th scope="col">座位</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>
                    <time dateTime={new Date(record.occurredAt).toISOString()}>
                      {new Date(record.occurredAt).toLocaleString('zh-CN', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
                      })}
                    </time>
                  </td>
                  <td>{record.seatNumber === undefined ? '未知座位' : `座位 ${record.seatNumber}`}</td>
                  <td><span className="log-action">{record.action === 'START' ? '开始计时' : '结束计时'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
