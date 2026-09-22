import { db } from '../db/database';
import type { Session } from '../db/models';

export async function startSession(seatId: string): Promise<Session> {
  return db.transaction('rw', db.seats, db.sessions, db.operationLogs, async () => {
    const seat = await db.seats.get(seatId);

    if (!seat || seat.isActive !== true) {
      throw new Error('座位不存在或未启用');
    }

    const activeSession = await db.sessions
      .where('[seatId+status]')
      .equals([seatId, 'active'])
      .first();

    if (activeSession) {
      throw new Error('该座位已有进行中的计时，不能重复开始');
    }

    const sessionId = crypto.randomUUID();
    const logId = crypto.randomUUID();
    const now = Date.now();
    const session: Session = {
      id: sessionId,
      seatId,
      startedAt: now,
      endedAt: null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    await db.sessions.add(session);
    await db.operationLogs.add({
      id: logId,
      sessionId,
      seatId,
      action: 'START',
      occurredAt: now,
    });

    return session;
  });
}

export async function endSession(sessionId: string): Promise<Session> {
  return db.transaction('rw', db.sessions, db.operationLogs, async () => {
    const session = await db.sessions.get(sessionId);

    if (!session) {
      throw new Error('计时记录不存在');
    }

    if (session.status !== 'active' || session.endedAt !== null) {
      throw new Error('该计时已结束或状态无效，不能重复结束');
    }

    const logId = crypto.randomUUID();
    const now = Date.now();
    const updates = {
      status: 'completed' as const,
      endedAt: now,
      updatedAt: now,
    };

    await db.sessions.update(sessionId, updates);
    await db.operationLogs.add({
      id: logId,
      sessionId,
      seatId: session.seatId,
      action: 'END',
      occurredAt: now,
    });

    return { ...session, ...updates };
  });
}
