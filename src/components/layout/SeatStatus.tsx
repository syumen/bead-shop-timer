import type { Session } from '../../db/models';

export function mapActiveSessionsBySeat(sessions: readonly Session[]): Map<string, Session> {
  const bySeat = new Map<string, Session>();
  for (const session of sessions) {
    if (session.status === 'active') {
      bySeat.set(session.seatId, session);
    }
  }
  return bySeat;
}

export function formatElapsedTime(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return [hours, minutes, seconds % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

interface SeatStatusProps {
  seatNumber: number;
  activeSession?: Session;
  now: number;
}

export default function SeatStatus({ seatNumber, activeSession, now }: SeatStatusProps) {
  return (
    <>
      <span>座位 {seatNumber}</span>
      <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {activeSession ? formatElapsedTime(activeSession.startedAt, now) : '空闲'}
      </span>
    </>
  );
}
