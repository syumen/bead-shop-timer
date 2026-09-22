export interface Seat {
  id: string;
  seatNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Table {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  seatId: string;
  startedAt: number;
  endedAt: number | null;
  status: 'active' | 'completed';
  createdAt: number;
  updatedAt: number;
}

export interface OperationLog {
  id: string;
  sessionId: string;
  seatId: string;
  action: 'START' | 'END';
  occurredAt: number;
}
