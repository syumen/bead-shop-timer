import { db } from '../db/database';
import type { OperationLog, Seat, Session, Table } from '../db/models';

export interface BackupData {
  version: 1;
  exportedAt: number;
  seats: Seat[];
  tables: Table[];
  sessions: Session[];
  operationLogs: OperationLog[];
}

type RecordData = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordData =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const isId = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const hasNumbers = (row: RecordData, keys: string[]) => keys.every((key) => isNumber(row[key]));

function isLayout(row: RecordData): boolean {
  return hasNumbers(row, ['x', 'y', 'width', 'height', 'rotation', 'createdAt', 'updatedAt'])
    && typeof row.isActive === 'boolean';
}

function validateRows(value: unknown, name: string, valid: (row: RecordData) => boolean) {
  if (!Array.isArray(value)) throw new Error(`备份结构错误：${name} 必须是数组`);
  const ids = new Set<string>();
  for (const row of value) {
    if (!isRecord(row) || !isId(row.id) || !valid(row)) {
      throw new Error(`备份结构错误：${name} 包含无效记录`);
    }
    const id = row.id as string;
    if (ids.has(id)) throw new Error(`备份结构错误：${name} 包含重复 ID`);
    ids.add(id);
  }
}

function parseBackup(data: unknown): BackupData {
  let backup: unknown;
  try {
    // Snapshot the caller's data before validation and the asynchronous transaction.
    backup = typeof data === 'string' ? JSON.parse(data) : structuredClone(data);
  } catch {
    throw new Error('备份格式无效，请选择有效的 JSON 备份文件');
  }
  if (!isRecord(backup)) throw new Error('备份结构错误：必须是 JSON 对象');
  if (backup.version !== 1) throw new Error('不支持此备份版本，仅支持 version 1');
  if (!isNumber(backup.exportedAt)) throw new Error('备份结构错误：exportedAt 无效');
  validateRows(backup.seats, 'seats', (row) => isLayout(row) && isNumber(row.seatNumber));
  validateRows(backup.tables, 'tables', isLayout);
  validateRows(backup.sessions, 'sessions', (row) =>
    isId(row.seatId) && hasNumbers(row, ['startedAt', 'createdAt', 'updatedAt'])
    && (row.endedAt === null || isNumber(row.endedAt))
    && (row.status === 'active' || row.status === 'completed'));
  validateRows(backup.operationLogs, 'operationLogs', (row) =>
    isId(row.sessionId) && isId(row.seatId) && isNumber(row.occurredAt)
    && (row.action === 'START' || row.action === 'END'));
  return backup as unknown as BackupData;
}

export async function exportBackup(): Promise<BackupData> {
  return db.transaction('r', [db.seats, db.layoutTables, db.sessions, db.operationLogs], async () => ({
    version: 1 as const,
    exportedAt: Date.now(),
    seats: await db.seats.toArray(),
    tables: await db.layoutTables.toArray(),
    sessions: await db.sessions.toArray(),
    operationLogs: await db.operationLogs.toArray(),
  }));
}

export async function importBackup(data: unknown): Promise<void> {
  const backup = parseBackup(data);
  await db.transaction('rw', [db.seats, db.layoutTables, db.sessions, db.operationLogs], async () => {
    await db.seats.clear();
    await db.layoutTables.clear();
    await db.sessions.clear();
    await db.operationLogs.clear();
    await db.seats.bulkAdd(backup.seats);
    await db.layoutTables.bulkAdd(backup.tables);
    await db.sessions.bulkAdd(backup.sessions);
    await db.operationLogs.bulkAdd(backup.operationLogs);
  });
}
