import { useEffect, useState } from 'react';
import { Rnd } from 'react-rnd';
import type { Seat, Session } from '../../db/models';
import { getLayoutFrame } from '../../services/layoutService';
import SeatStatus from './SeatStatus';

interface SeatItemProps {
  seat: Seat;
  activeSession?: Session;
  now: number;
  isEditing: boolean;
  onPositionChange: (x: number, y: number) => Promise<boolean>;
  onRemove?: () => void;
  onSelect?: () => void;
  isSaving?: boolean;
}

export default function SeatItem({
  seat,
  activeSession,
  now,
  isEditing,
  onPositionChange,
  onRemove,
  onSelect,
  isSaving = false,
}: SeatItemProps) {
  const [position, setPosition] = useState({ x: seat.x, y: seat.y });
  const frame = getLayoutFrame(seat);
  const canSelect = !isEditing && !isSaving && Boolean(onSelect);

  useEffect(() => {
    setPosition({ x: seat.x, y: seat.y });
  }, [seat.x, seat.y]);

  async function handleDragStop(x: number, y: number) {
    if (!isEditing || isSaving) return;

    const next = { x: x + frame.offsetX, y: y + frame.offsetY };
    setPosition(next);
    if (!(await onPositionChange(next.x, next.y))) {
      setPosition({ x: seat.x, y: seat.y });
    }
  }

  return (
    <Rnd
      size={{ width: frame.width, height: frame.height }}
      position={{ x: position.x - frame.offsetX, y: position.y - frame.offsetY }}
      bounds="parent"
      disableDragging={!isEditing || isSaving}
      enableResizing={false}
      cancel="button"
      onDragStop={(_, data) => void handleDragStop(data.x, data.y)}
      style={{ zIndex: 1, cursor: isEditing && !isSaving ? 'grab' : canSelect ? 'pointer' : 'default' }}
    >
      <div
        className="seat-item"
        aria-label={`座位 ${seat.seatNumber}`}
        role={canSelect ? 'button' : undefined}
        tabIndex={canSelect ? 0 : undefined}
        onClick={canSelect ? onSelect : undefined}
        onKeyDown={canSelect ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect?.();
          }
        } : undefined}
        draggable={false}
        style={{
          position: 'absolute',
          left: frame.offsetX,
          top: frame.offsetY,
          width: seat.width,
          height: seat.height,
          transform: `rotate(${seat.rotation}deg)`,
          transformOrigin: 'center',
          boxSizing: 'border-box',
          touchAction: isEditing ? 'none' : 'auto',
        }}
      >
        {isEditing ? (
          <span>{seat.seatNumber}</span>
        ) : (
          <SeatStatus seatNumber={seat.seatNumber} activeSession={activeSession} now={now} />
        )}
        {onRemove && (
          <button
            type="button"
            className="canvas-delete"
            aria-label={`删除座位 ${seat.seatNumber}`}
            disabled={isSaving}
            onClick={onRemove}
          >
            删除
          </button>
        )}
      </div>
    </Rnd>
  );
}
