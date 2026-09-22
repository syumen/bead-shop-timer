import { Dexie, type Table as DexieTable } from 'dexie';
import type { OperationLog, Seat, Session, Table } from './models';

export class BeadShopDB extends Dexie {
  declare seats: DexieTable<Seat, string>;
  declare layoutTables: DexieTable<Table, string>;
  declare sessions: DexieTable<Session, string>;
  declare operationLogs: DexieTable<OperationLog, string>;

  constructor() {
    super('BeadShopDB');

    this.version(1).stores({
      seats: 'id',
      tables: 'id',
      sessions: 'id, [seatId+status]',
      operationLogs: 'id',
    });

    // Dexie reserves `tables` for its list of stores.
    this.layoutTables = this.table<Table, string>('tables');
  }
}

export const db = new BeadShopDB();
