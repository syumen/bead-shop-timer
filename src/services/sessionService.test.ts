import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/database';
import type { Seat } from '../db/models';
import { endSession, startSession } from './sessionService';

const seat: Seat = {
  id: 'seat-1',
  seatNumber: 1,
  x: 0,
  y: 0,
  width: 40,
  height: 40,
  rotation: 0,
  isActive: true,
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.delete();
});

describe('startSession', () => {
  it('正常开始时创建一个 active Session 和一条 START 日志', async () => {
    await db.seats.add(seat);

    const session = await startSession(seat.id);

    expect(await db.sessions.toArray()).toEqual([session]);
    expect(session).toMatchObject({
      id: expect.any(String),
      seatId: seat.id,
      status: 'active',
      endedAt: null,
      startedAt: expect.any(Number),
      createdAt: session.startedAt,
      updatedAt: session.startedAt,
    });
    expect(await db.operationLogs.toArray()).toEqual([
      {
        id: expect.any(String),
        sessionId: session.id,
        seatId: seat.id,
        action: 'START',
        occurredAt: session.startedAt,
      },
    ]);
  });

  it('同一座位重复开始时失败，且不新增 Session 或日志', async () => {
    await db.seats.add(seat);
    const session = await startSession(seat.id);
    const logs = await db.operationLogs.toArray();

    await expect(startSession(seat.id)).rejects.toThrow();

    expect(await db.sessions.toArray()).toEqual([session]);
    expect(await db.operationLogs.toArray()).toEqual(logs);
  });

  it('座位不存在时失败，且不产生 Session 或日志', async () => {
    await expect(startSession(seat.id)).rejects.toThrow();

    expect(await db.sessions.count()).toBe(0);
    expect(await db.operationLogs.count()).toBe(0);
  });

  it('座位已停用时失败，且不产生 Session 或日志', async () => {
    await db.seats.add({ ...seat, isActive: false });

    await expect(startSession(seat.id)).rejects.toThrow();

    expect(await db.sessions.count()).toBe(0);
    expect(await db.operationLogs.count()).toBe(0);
  });
});

describe('endSession', () => {
  it('正常结束时更新 Session 为 completed，并追加一条 END 日志', async () => {
    await db.seats.add(seat);
    const session = await startSession(seat.id);
    const startLogs = await db.operationLogs.toArray();
    const endedAt = session.startedAt + 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(endedAt);

    await endSession(session.id);

    expect(await db.sessions.toArray()).toEqual([
      { ...session, status: 'completed', endedAt, updatedAt: endedAt },
    ]);
    const logs = await db.operationLogs.toArray();
    expect(logs).toHaveLength(2);
    expect(logs).toEqual(expect.arrayContaining(startLogs));
    expect(logs.filter((log) => log.action === 'END')).toEqual([
      {
        id: expect.any(String),
        sessionId: session.id,
        seatId: seat.id,
        action: 'END',
        occurredAt: endedAt,
      },
    ]);
  });

  it('结束时间与 END 日志时间一致，即使每次读取时钟的结果不同', async () => {
    await db.seats.add(seat);
    const session = await startSession(seat.id);
    let now = session.startedAt + 60_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now++);

    await endSession(session.id);

    const completed = await db.sessions.get(session.id);
    const endLogs = (await db.operationLogs.toArray()).filter(
      (log) => log.action === 'END',
    );
    expect(endLogs).toHaveLength(1);
    expect(completed?.endedAt).toEqual(expect.any(Number));
    expect(completed?.endedAt).toBe(endLogs[0].occurredAt);
    expect(completed?.updatedAt).toBe(endLogs[0].occurredAt);
  });

  it('重复结束时失败，且不新增日志或修改 Session', async () => {
    await db.seats.add(seat);
    const session = await startSession(seat.id);
    await endSession(session.id);
    const completed = await db.sessions.get(session.id);
    const logs = await db.operationLogs.toArray();

    await expect(endSession(session.id)).rejects.toThrow();

    expect(await db.sessions.toArray()).toEqual([completed]);
    expect(await db.operationLogs.toArray()).toEqual(logs);
  });
});
