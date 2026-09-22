import type { Session } from '../db/models';

export function formatSessionDuration(session: Pick<Session, 'startedAt' | 'endedAt'>): string {
  if (session.endedAt === null) return '时长异常';
  const durationMs = session.endedAt - session.startedAt;
  if (!Number.isFinite(durationMs) || durationMs < 0) return '时长异常';
  const totalMinutes = Math.floor(durationMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}小时 ${minutes}分钟` : `${minutes}分钟`;
}
