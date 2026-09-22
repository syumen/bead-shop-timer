import { db } from '../db/database';
import type { Seat, Table } from '../db/models';

export const LAYOUT_WIDTH = 1200;
export const LAYOUT_HEIGHT = 800;
export const TABLE_MIN_WIDTH = 80;
export const TABLE_MIN_HEIGHT = 60;

export type TableLayout = Pick<Table, 'x' | 'y' | 'width' | 'height'>;

function initialPosition(index: number, width: number, height: number, startX: number, startY: number) {
  const gap = 24;
  const columns = Math.floor((LAYOUT_WIDTH - startX + gap) / (width + gap));
  const rows = Math.floor((LAYOUT_HEIGHT - startY + gap) / (height + gap));
  const slot = index % (columns * rows);

  return {
    x: startX + (slot % columns) * (width + gap),
    y: startY + Math.floor(slot / columns) * (height + gap),
  };
}

// The draggable frame contains the entire rotated rectangle.
export function getLayoutFrame(element: Pick<Seat, 'width' | 'height' | 'rotation'>) {
  const radians = (element.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const width = element.width * cos + element.height * sin;
  const height = element.width * sin + element.height * cos;

  return {
    width,
    height,
    offsetX: (width - element.width) / 2,
    offsetY: (height - element.height) / 2,
  };
}

function constrainPosition(element: Seat | Table, x: number, y: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('位置坐标无效');
  }

  const frame = getLayoutFrame(element);
  if (frame.width > LAYOUT_WIDTH || frame.height > LAYOUT_HEIGHT) {
    throw new Error('元素尺寸超出画布范围');
  }

  return {
    x: Math.min(Math.max(x, frame.offsetX), LAYOUT_WIDTH - frame.width + frame.offsetX),
    y: Math.min(Math.max(y, frame.offsetY), LAYOUT_HEIGHT - frame.height + frame.offsetY),
  };
}

// Convert the resize wrapper's bounds back to the table's unrotated dimensions.
export function tableLayoutFromFrame(table: Table, frame: TableLayout): TableLayout {
  const radians = (table.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const determinant = cos * cos - sin * sin;
  const originalFrame = getLayoutFrame(table);
  const ratio = Math.min(frame.width / originalFrame.width, frame.height / originalFrame.height);
  const width = Math.max(TABLE_MIN_WIDTH, Math.abs(determinant) < 1e-8
    ? table.width * ratio
    : (cos * frame.width - sin * frame.height) / determinant);
  const height = Math.max(TABLE_MIN_HEIGHT, Math.abs(determinant) < 1e-8
    ? table.height * ratio
    : (cos * frame.height - sin * frame.width) / determinant);
  const minimumFrame = getLayoutFrame({
    width: TABLE_MIN_WIDTH,
    height: TABLE_MIN_HEIGHT,
    rotation: table.rotation,
  });
  const desiredFrame = getLayoutFrame({ ...table, width, height });
  const allowedWidth = Math.max(minimumFrame.width, Math.min(LAYOUT_WIDTH, frame.width));
  const allowedHeight = Math.max(minimumFrame.height, Math.min(LAYOUT_HEIGHT, frame.height));
  const widthGrowth = desiredFrame.width - minimumFrame.width;
  const heightGrowth = desiredFrame.height - minimumFrame.height;
  let fit = Math.max(0, Math.min(
    1,
    widthGrowth > 0 ? (allowedWidth - minimumFrame.width) / widthGrowth : 1,
    heightGrowth > 0 ? (allowedHeight - minimumFrame.height) / heightGrowth : 1,
  ));
  // Leave a subpixel margin when fitting to avoid floating-point overflow at the boundary.
  if (fit < 1) fit *= 1 - 1e-12;
  const resized = {
    ...table,
    width: TABLE_MIN_WIDTH + (width - TABLE_MIN_WIDTH) * fit,
    height: TABLE_MIN_HEIGHT + (height - TABLE_MIN_HEIGHT) * fit,
  };
  const resizedFrame = getLayoutFrame(resized);
  const position = constrainPosition(
    resized,
    frame.x + resizedFrame.offsetX,
    frame.y + resizedFrame.offsetY,
  );

  return { ...position, width: resized.width, height: resized.height };
}

export async function addSeat(): Promise<Seat> {
  return db.transaction('rw', db.seats, async () => {
    const seats = await db.seats.toArray();
    const maxSeatNumber = seats.reduce(
      (max, seat) => Math.max(max, seat.seatNumber),
      0,
    );
    const now = Date.now();
    const seat: Seat = {
      id: crypto.randomUUID(),
      seatNumber: maxSeatNumber + 1,
      ...initialPosition(seats.length, 64, 64, 80, 80),
      width: 64,
      height: 64,
      rotation: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    await db.seats.add(seat);
    return seat;
  });
}

export async function addTable(): Promise<Table> {
  return db.transaction('rw', db.layoutTables, async () => {
    const count = await db.layoutTables.count();
    const now = Date.now();
    const table: Table = {
      id: crypto.randomUUID(),
      ...initialPosition(count, 160, 100, 240, 160),
      width: 160,
      height: 100,
      rotation: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    await db.layoutTables.add(table);
    return table;
  });
}

export async function removeSeat(id: string): Promise<void> {
  await db.transaction('rw', db.seats, db.sessions, async () => {
    const seat = await db.seats.get(id);

    if (!seat) {
      throw new Error('座位不存在');
    }

    const activeSession = await db.sessions
      .where('[seatId+status]')
      .equals([id, 'active'])
      .first();

    if (activeSession) {
      throw new Error('该座位正在计时，不能删除');
    }

    await db.seats.update(id, { isActive: false, updatedAt: Date.now() });
  });
}

export async function removeTable(id: string): Promise<void> {
  const updated = await db.layoutTables.update(id, {
    isActive: false,
    updatedAt: Date.now(),
  });

  if (updated === 0) {
    throw new Error('桌子不存在');
  }
}

export async function updateSeatPosition(id: string, x: number, y: number): Promise<void> {
  await db.transaction('rw', db.seats, async () => {
    const seat = await db.seats.get(id);
    if (!seat) {
      throw new Error('座位不存在');
    }

    const position = constrainPosition(seat, x, y);
    await db.seats.update(id, { ...position, updatedAt: Date.now() });
  });
}

export async function updateTablePosition(id: string, x: number, y: number): Promise<void> {
  await db.transaction('rw', db.layoutTables, async () => {
    const table = await db.layoutTables.get(id);
    if (!table) {
      throw new Error('桌子不存在');
    }

    const position = constrainPosition(table, x, y);
    await db.layoutTables.update(id, { ...position, updatedAt: Date.now() });
  });
}

export async function updateTableLayout(id: string, layout: TableLayout): Promise<void> {
  if (
    !Number.isFinite(layout.width) || !Number.isFinite(layout.height) ||
    layout.width < TABLE_MIN_WIDTH || layout.height < TABLE_MIN_HEIGHT
  ) {
    throw new Error(`桌子尺寸不得小于 ${TABLE_MIN_WIDTH} × ${TABLE_MIN_HEIGHT}`);
  }

  await db.transaction('rw', db.layoutTables, async () => {
    const table = await db.layoutTables.get(id);
    if (!table) {
      throw new Error('桌子不存在');
    }

    const { width, height } = layout;
    const position = constrainPosition({ ...table, width, height }, layout.x, layout.y);
    await db.layoutTables.update(id, { ...position, width, height, updatedAt: Date.now() });
  });
}
