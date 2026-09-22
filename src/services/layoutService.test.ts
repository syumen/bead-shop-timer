import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/database';
import {
  addSeat,
  addTable,
  getLayoutFrame,
  removeSeat,
  removeTable,
  tableLayoutFromFrame,
  updateSeatPosition,
  updateTableLayout,
  updateTablePosition,
} from './layoutService';
import { endSession, startSession } from './sessionService';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

describe('addSeat', () => {
  it('连续新增座位按确定的网格错开', async () => {
    const seats = [await addSeat(), await addSeat(), await addSeat()];

    expect(seats.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 80, y: 80 }, { x: 168, y: 80 }, { x: 256, y: 80 },
    ]);
  });

  it('新增启用的座位，写入 UUID、默认尺寸和一致的创建更新时间', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const seat = await addSeat();

    expect(await db.seats.toArray()).toEqual([seat]);
    expect(seat).toMatchObject({
      id: expect.stringMatching(uuidPattern),
      seatNumber: 1,
      isActive: true,
      rotation: 0,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(seat.x).toBeGreaterThanOrEqual(0);
    expect(seat.y).toBeGreaterThanOrEqual(0);
    expect(seat.width).toBeGreaterThan(0);
    expect(seat.height).toBeGreaterThan(0);
    expect(seat.x + seat.width).toBeLessThanOrEqual(1200);
    expect(seat.y + seat.height).toBeLessThanOrEqual(800);
  });

  it('编号递增，并以最大编号而非座位数量为依据', async () => {
    const first = await addSeat();
    const second = await addSeat();
    await db.seats.update(second.id, { seatNumber: 9 });

    const third = await addSeat();

    expect(first.seatNumber).toBe(1);
    expect(second.seatNumber).toBe(2);
    expect(third.seatNumber).toBe(10);
    expect(await db.seats.count()).toBe(3);
  });

  it('分配编号时包含已停用座位的最大编号', async () => {
    await addSeat();
    const inactive = await addSeat();
    await db.seats.update(inactive.id, { seatNumber: 50, isActive: false });

    const seat = await addSeat();

    expect(seat.seatNumber).toBe(51);
  });

  it('创建座位 1、2、3 并删除座位 3 后，再新增的编号为 4', async () => {
    const first = await addSeat();
    const second = await addSeat();
    const third = await addSeat();
    expect([first.seatNumber, second.seatNumber, third.seatNumber]).toEqual([1, 2, 3]);

    await removeSeat(third.id);

    const fourth = await addSeat();

    expect(fourth.seatNumber).toBe(4);
    expect(await db.seats.get(third.id)).toMatchObject({
      seatNumber: 3,
      isActive: false,
    });
    expect(await db.seats.get(fourth.id)).toMatchObject({
      seatNumber: 4,
      isActive: true,
    });
    expect(await db.seats.count()).toBe(4);
  });

  it('并发新增时不分配重复编号或 ID', async () => {
    const seats = await Promise.all([addSeat(), addSeat(), addSeat()]);

    expect(seats.map((seat) => seat.seatNumber).sort((a, b) => a - b)).toEqual([
      1, 2, 3,
    ]);
    expect(new Set(seats.map((seat) => seat.id)).size).toBe(3);
    expect(await db.seats.count()).toBe(3);
  });
});

describe('addTable', () => {
  it('并发新增桌子时也按确定的网格错开', async () => {
    const tables = await Promise.all([addTable(), addTable(), addTable()]);

    expect(tables.map(({ x, y }) => ({ x, y })).sort((a, b) => a.x - b.x)).toEqual([
      { x: 240, y: 160 }, { x: 424, y: 160 }, { x: 608, y: 160 },
    ]);
  });

  it('新增启用的桌子，写入 UUID、默认尺寸和时间', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const table = await addTable();

    expect(await db.layoutTables.toArray()).toEqual([table]);
    expect(table).toMatchObject({
      id: expect.stringMatching(uuidPattern),
      isActive: true,
      rotation: 0,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    expect(table.x).toBeGreaterThanOrEqual(0);
    expect(table.y).toBeGreaterThanOrEqual(0);
    expect(table.width).toBeGreaterThan(0);
    expect(table.height).toBeGreaterThan(0);
    expect(table.x + table.width).toBeLessThanOrEqual(1200);
    expect(table.y + table.height).toBeLessThanOrEqual(800);
  });
});

describe.each([
  { name: 'Seat', add: addSeat, capacity: 104 },
  { name: 'Table', add: addTable, capacity: 25 },
])('$name 初始位置', ({ add, capacity }) => {
  it('网格换行并循环后仍然在画布范围内', async () => {
    const first = await add();
    for (let index = 1; index <= capacity; index++) {
      const element = await add();
      expect(element.x).toBeGreaterThanOrEqual(0);
      expect(element.y).toBeGreaterThanOrEqual(0);
      expect(element.x + element.width).toBeLessThanOrEqual(1200);
      expect(element.y + element.height).toBeLessThanOrEqual(800);
      if (index === capacity) {
        expect({ x: element.x, y: element.y }).toEqual({ x: first.x, y: first.y });
      }
    }
  });
});

describe('updateTableLayout', () => {
  it('持久化更新位置、尺寸和 updatedAt，保留其他字段和其他桌子', async () => {
    const table = { ...await addTable(), rotation: 30 };
    await db.layoutTables.put(table);
    const other = await addTable();
    const updatedAt = table.updatedAt + 1_000;
    vi.spyOn(Date, 'now').mockReturnValue(updatedAt);
    const next = { x: 300, y: 220, width: 280, height: 180 };

    await updateTableLayout(table.id, next);
    db.close();
    await db.open();

    expect(await db.layoutTables.get(table.id)).toEqual({ ...table, ...next, updatedAt });
    expect(await db.layoutTables.get(other.id)).toEqual(other);
  });

  it('允许调整到最小尺寸 80 × 60', async () => {
    const table = await addTable();

    await updateTableLayout(table.id, { x: 0, y: 0, width: 80, height: 60 });

    expect(await db.layoutTables.get(table.id)).toMatchObject({
      x: 0, y: 0, width: 80, height: 60,
    });
  });

  it.each([
    { label: '左上', x: -100, y: -100, expectedX: 0, expectedY: 0 },
    { label: '右下', x: 2_000, y: 2_000, expectedX: 900, expectedY: 600 },
  ])('按新尺寸限制$label边界', async ({ x, y, expectedX, expectedY }) => {
    const table = await addTable();

    await updateTableLayout(table.id, { x, y, width: 300, height: 200 });

    expect(await db.layoutTables.get(table.id)).toMatchObject({
      x: expectedX, y: expectedY, width: 300, height: 200,
    });
  });

  it.each([
    { x: 100, y: 100, width: 79, height: 100 },
    { x: 100, y: 100, width: 100, height: 59 },
    { x: 100, y: 100, width: Number.NaN, height: 100 },
    { x: Number.POSITIVE_INFINITY, y: 100, width: 100, height: 100 },
  ])('拒绝无效尺寸或坐标，保留原记录：%j', async (next) => {
    const table = await addTable();

    await expect(updateTableLayout(table.id, next)).rejects.toThrow();

    expect(await db.layoutTables.get(table.id)).toEqual(table);
  });

  it('旋转后尺寸超出画布时拒绝保存', async () => {
    const table = { ...await addTable(), rotation: 45 };
    await db.layoutTables.put(table);

    await expect(updateTableLayout(table.id, {
      x: 100, y: 100, width: 900, height: 700,
    })).rejects.toThrow('元素尺寸超出画布范围');

    expect(await db.layoutTables.get(table.id)).toEqual(table);
  });

  it('不存在的桌子不能更新，也不会创建记录', async () => {
    await expect(updateTableLayout('missing', {
      x: 100, y: 100, width: 160, height: 100,
    })).rejects.toThrow('桌子不存在');

    expect(await db.layoutTables.count()).toBe(0);
  });
});

describe('tableLayoutFromFrame', () => {
  it.each([0, 45, 90])('正确换算旋转 %i 度的 resize 框，且不写数据库', async (rotation) => {
    const table = { ...await addTable(), rotation };
    await db.layoutTables.put(table);
    const resizedFrame = getLayoutFrame({ ...table, width: 320, height: 200 });

    const next = tableLayoutFromFrame(table, {
      x: 200, y: 180, width: resizedFrame.width, height: resizedFrame.height,
    });

    expect(next.width).toBeCloseTo(320);
    expect(next.height).toBeCloseTo(200);
    expect(next.x - resizedFrame.offsetX).toBeCloseTo(200);
    expect(next.y - resizedFrame.offsetY).toBeCloseTo(180);
    expect(await db.layoutTables.get(table.id)).toEqual(table);
  });
});

describe('removeSeat', () => {
  it('普通座位仅软删除，并更新 updatedAt', async () => {
    const seat = await addSeat();
    const removedAt = seat.updatedAt + 1_000;
    vi.spyOn(Date, 'now').mockReturnValue(removedAt);

    await removeSeat(seat.id);

    expect(await db.seats.toArray()).toEqual([
      { ...seat, isActive: false, updatedAt: removedAt },
    ]);
  });

  it('有 active Session 时拒绝删除，座位、Session 和日志均不变', async () => {
    const seat = await addSeat();
    const session = await startSession(seat.id);
    const logs = await db.operationLogs.toArray();

    await expect(removeSeat(seat.id)).rejects.toThrow('该座位正在计时，不能删除');

    expect(await db.seats.get(seat.id)).toEqual(seat);
    expect(await db.sessions.toArray()).toEqual([session]);
    expect(await db.operationLogs.toArray()).toEqual(logs);
  });

  it('已完成计时的座位可以软删除，并保留历史 Session 和日志', async () => {
    const seat = await addSeat();
    const session = await startSession(seat.id);
    const completed = await endSession(session.id);
    const logs = await db.operationLogs.toArray();

    await removeSeat(seat.id);

    expect(await db.seats.get(seat.id)).toMatchObject({ id: seat.id, isActive: false });
    expect(await db.seats.count()).toBe(1);
    expect(await db.sessions.toArray()).toEqual([completed]);
    expect(await db.operationLogs.toArray()).toEqual(logs);
  });
});

describe('removeTable', () => {
  it('桌子仅软删除，并更新 updatedAt', async () => {
    const table = await addTable();
    const removedAt = table.updatedAt + 1_000;
    vi.spyOn(Date, 'now').mockReturnValue(removedAt);

    await removeTable(table.id);

    expect(await db.layoutTables.toArray()).toEqual([
      { ...table, isActive: false, updatedAt: removedAt },
    ]);
  });
});

describe.each([
  { name: 'Seat', add: addSeat, update: updateSeatPosition, getStore: () => db.seats },
  { name: 'Table', add: addTable, update: updateTablePosition, getStore: () => db.layoutTables },
])('$name 位置更新', ({ add, update, getStore }) => {
  it('只更新 x、y 和 updatedAt，重新打开数据库后位置仍然保留', async () => {
    const element = await add();
    const other = await add();
    const updatedAt = element.updatedAt + 1_000;
    vi.spyOn(Date, 'now').mockReturnValue(updatedAt);

    await update(element.id, 350, 280);
    db.close();
    await db.open();

    expect(await getStore().get(element.id)).toEqual({
      ...element,
      x: 350,
      y: 280,
      updatedAt,
    });
    expect(await getStore().get(other.id)).toEqual(other);
  });

  it.each([
    { label: '左上', x: -100, y: -100 },
    { label: '右下', x: 2_000, y: 2_000 },
  ])('超出画布$label边界时限制到画布内', async ({ x, y }) => {
    const element = await add();

    await update(element.id, x, y);

    const saved = await getStore().get(element.id);
    expect(saved?.x).toBe(x < 0 ? 0 : 1200 - element.width);
    expect(saved?.y).toBe(y < 0 ? 0 : 800 - element.height);
  });

  it('边界限制包含旋转后的完整矩形，且不改变旋转和尺寸', async () => {
    const element = await add();
    await getStore().update(element.id, { rotation: 90 });

    await update(element.id, -1_000, -1_000);
    const topLeft = (await getStore().get(element.id))!;
    expect(topLeft.x + element.width / 2 - element.height / 2).toBeCloseTo(0);
    expect(topLeft.y + element.height / 2 - element.width / 2).toBeCloseTo(0);

    await update(element.id, 2_000, 2_000);
    const bottomRight = (await getStore().get(element.id))!;
    expect(bottomRight.x + element.width / 2 + element.height / 2).toBeCloseTo(1200);
    expect(bottomRight.y + element.height / 2 + element.width / 2).toBeCloseTo(800);
    expect(bottomRight).toMatchObject({
      rotation: 90,
      width: element.width,
      height: element.height,
    });
  });

  it('不存在的元素不能更新，也不会创建新记录', async () => {
    await expect(update('missing', 100, 100)).rejects.toThrow('不存在');

    expect(await getStore().count()).toBe(0);
  });

  it('无效坐标不会修改元素', async () => {
    const element = await add();

    await expect(update(element.id, Number.NaN, 100)).rejects.toThrow('位置坐标无效');
    await expect(update(element.id, 100, Number.POSITIVE_INFINITY)).rejects.toThrow('位置坐标无效');

    expect(await getStore().get(element.id)).toEqual(element);
  });
});
