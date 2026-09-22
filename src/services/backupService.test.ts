import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/database';
import { exportBackup, importBackup, type BackupData } from './backupService';

function backup(): BackupData {
  return {
    version: 1, exportedAt: 5000,
    seats: [{
      id: 'seat-history', seatNumber: 8, x: 90, y: 200, width: 64, height: 64,
      rotation: 0, isActive: false, createdAt: 100, updatedAt: 4000,
    }, {
      id: 'seat-active', seatNumber: 9, x: 200, y: 200, width: 64, height: 64,
      rotation: 0, isActive: true, createdAt: 100, updatedAt: 100,
    }],
    tables: [{
      id: 'table-1', x: 400, y: 300, width: 200, height: 100,
      rotation: 90, isActive: true, createdAt: 100, updatedAt: 200,
    }],
    sessions: [{
      id: 'session-completed', seatId: 'seat-history', startedAt: 1000, endedAt: 3000,
      status: 'completed', createdAt: 1000, updatedAt: 3000,
    }, {
      id: 'session-active', seatId: 'seat-active', startedAt: 4000, endedAt: null,
      status: 'active', createdAt: 4000, updatedAt: 4000,
    }],
    operationLogs: [
      { id: 'log-start', sessionId: 'session-completed', seatId: 'seat-history', action: 'START', occurredAt: 1000 },
      { id: 'log-end', sessionId: 'session-completed', seatId: 'seat-history', action: 'END', occurredAt: 3000 },
      { id: 'log-active', sessionId: 'session-active', seatId: 'seat-active', action: 'START', occurredAt: 4000 },
    ],
  };
}

async function contents() {
  return {
    seats: await db.seats.toArray(), tables: await db.layoutTables.toArray(),
    sessions: await db.sessions.toArray(), operationLogs: await db.operationLogs.toArray(),
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  const data = backup();
  await db.seats.bulkAdd(data.seats);
  await db.layoutTables.bulkAdd(data.tables);
  await db.sessions.bulkAdd(data.sessions);
  await db.operationLogs.bulkAdd(data.operationLogs);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

describe('本地备份', () => {
  it('完整导出四张表，包括软删除座位，保留所有 ID、时间戳和历史记录', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(6000);
    const original = await contents();
    const exported = await exportBackup();
    expect(exported).toEqual({ version: 1, exportedAt: 6000, ...original });
    expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);
    expect(await contents()).toEqual(original);
  });

  it('有效 JSON 能覆盖原数据，恢复后 Session 与日志关联和原始字段不变', async () => {
    const saved = await exportBackup();
    await db.seats.update('seat-history', { seatNumber: 99 });
    await db.layoutTables.add({ ...saved.tables[0], id: 'extra-table' });
    await db.sessions.clear();
    await db.operationLogs.clear();

    await importBackup(JSON.stringify(saved));

    const { version: _version, exportedAt: _exportedAt, ...expected } = saved;
    expect(await contents()).toEqual(expected);
    for (const log of await db.operationLogs.toArray()) {
      expect((await db.sessions.get(log.sessionId))?.seatId).toBe(log.seatId);
      expect(await db.seats.get(log.seatId)).toBeDefined();
    }
    expect((await db.seats.get('seat-history'))?.isActive).toBe(false);
  });

  it('支持空备份和对象输入，确认恢复时可清空四张表', async () => {
    await importBackup({ version: 1, exportedAt: 6000, seats: [], tables: [], sessions: [], operationLogs: [] });
    expect(await contents()).toEqual({ seats: [], tables: [], sessions: [], operationLogs: [] });
    expect(await exportBackup()).toMatchObject({ version: 1, seats: [], tables: [], sessions: [], operationLogs: [] });
  });

  it.each([
    ['非法 JSON', '{invalid'],
    ['不支持的 version', { ...backup(), version: 2 }],
    ['字符串 version', { ...backup(), version: '1' }],
    ['空对象', {}],
    ['null', null],
    ['非数组表', { ...backup(), tables: {} }],
    ['缺少表', { ...backup(), operationLogs: undefined }],
    ['非法 exportedAt', { ...backup(), exportedAt: 'today' }],
    ['Seat 缺少字段', { ...backup(), seats: [{ id: 'seat-1' }] }],
    ['Table 字段类型错误', { ...backup(), tables: [{ ...backup().tables[0], isActive: 'true' }] }],
    ['非有限数字', { ...backup(), seats: [{ ...backup().seats[0], x: Infinity }] }],
    ['非法 Session 状态', { ...backup(), sessions: [{ ...backup().sessions[0], status: 'other' }] }],
    ['非法 endedAt', { ...backup(), sessions: [{ ...backup().sessions[0], endedAt: '3000' }] }],
    ['非法日志操作', { ...backup(), operationLogs: [{ ...backup().operationLogs[0], action: 'DELETE' }] }],
    ['重复 ID', { ...backup(), seats: [backup().seats[0], backup().seats[0]] }],
  ])('%s 拒绝导入，验证失败时不开始写事务', async (_label, input) => {
    const original = await contents();
    const transaction = vi.spyOn(db, 'transaction');
    await expect(importBackup(input)).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
    expect(await contents()).toEqual(original);
  });

  it('最后一张表写入失败，前面清空与写入的四张表全部回滚', async () => {
    const original = await contents();
    const incoming = backup();
    incoming.seats[0].seatNumber = 88;
    incoming.tables[0].width = 350;
    incoming.sessions[0].endedAt = 3500;
    const fail = () => { throw new Error('模拟日志写入失败'); };
    db.operationLogs.hook('creating', fail);
    try {
      await expect(importBackup(incoming)).rejects.toThrow('模拟日志写入失败');
    } finally {
      db.operationLogs.hook('creating').unsubscribe(fail);
    }
    expect(await contents()).toEqual(original);
  });

  it('清空阶段失败也回滚，原始四张表保持不变', async () => {
    const original = await contents();
    const fail = () => { throw new Error('模拟清空失败'); };
    db.sessions.hook('deleting', fail);
    try {
      await expect(importBackup(backup())).rejects.toThrow('模拟清空失败');
    } finally {
      db.sessions.hook('deleting').unsubscribe(fail);
    }
    expect(await contents()).toEqual(original);
  });
});
