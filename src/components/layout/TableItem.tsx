import { useEffect, useRef, useState } from 'react';
import { Rnd, type RndResizeCallback } from 'react-rnd';
import type { Table } from '../../db/models';
import {
  getLayoutFrame,
  LAYOUT_HEIGHT,
  LAYOUT_WIDTH,
  TABLE_MIN_HEIGHT,
  TABLE_MIN_WIDTH,
  tableLayoutFromFrame,
  type TableLayout,
} from '../../services/layoutService';

interface TableItemProps {
  table: Table;
  isEditing: boolean;
  onPositionChange: (x: number, y: number) => Promise<boolean>;
  onLayoutChange: (layout: TableLayout) => Promise<boolean>;
  onRemove?: () => void;
  isSaving?: boolean;
}

export default function TableItem({
  table,
  isEditing,
  onPositionChange,
  onLayoutChange,
  onRemove,
  isSaving = false,
}: TableItemProps) {
  const [geometry, setGeometry] = useState<TableLayout>({
    x: table.x, y: table.y, width: table.width, height: table.height,
  });
  const resizeStart = useRef(table);
  const frame = getLayoutFrame({ ...table, ...geometry });
  const minimumFrame = getLayoutFrame({
    width: TABLE_MIN_WIDTH, height: TABLE_MIN_HEIGHT, rotation: table.rotation,
  });
  const canEdit = isEditing && !isSaving;

  useEffect(() => {
    setGeometry({ x: table.x, y: table.y, width: table.width, height: table.height });
  }, [table.x, table.y, table.width, table.height]);

  function restoreGeometry() {
    setGeometry({ x: table.x, y: table.y, width: table.width, height: table.height });
  }

  async function handleDragStop(x: number, y: number) {
    if (!isEditing || isSaving) return;

    const next = { x: x + frame.offsetX, y: y + frame.offsetY };
    setGeometry({ ...geometry, ...next });
    if (!(await onPositionChange(next.x, next.y))) {
      restoreGeometry();
    }
  }

  const previewResize: RndResizeCallback = (_, _direction, ref, _delta, position) => {
    if (!canEdit) return;
    setGeometry(tableLayoutFromFrame(resizeStart.current, {
      ...position,
      width: Number.parseFloat(ref.style.width),
      height: Number.parseFloat(ref.style.height),
    }));
  };

  const finishResize: RndResizeCallback = (_, _direction, ref, _delta, position) => {
    if (!canEdit) {
      restoreGeometry();
      return;
    }
    const next = tableLayoutFromFrame(resizeStart.current, {
      ...position,
      width: Number.parseFloat(ref.style.width),
      height: Number.parseFloat(ref.style.height),
    });
    setGeometry(next);
    void onLayoutChange(next).then((saved) => {
      if (!saved) restoreGeometry();
    });
  };

  return (
    <Rnd
      size={{ width: frame.width, height: frame.height }}
      position={{ x: geometry.x - frame.offsetX, y: geometry.y - frame.offsetY }}
      bounds="parent"
      disableDragging={!canEdit}
      enableResizing={canEdit}
      minWidth={minimumFrame.width}
      minHeight={minimumFrame.height}
      maxWidth={LAYOUT_WIDTH}
      maxHeight={LAYOUT_HEIGHT}
      // At diagonal rotations the bounding box cannot encode independent width and height.
      lockAspectRatio={Math.abs(Math.cos(table.rotation * Math.PI / 90)) < 1e-8}
      cancel="button"
      onDragStop={(_, data) => void handleDragStop(data.x, data.y)}
      onResizeStart={() => {
        if (!canEdit) return false;
        resizeStart.current = { ...table, ...geometry };
      }}
      onResize={previewResize}
      onResizeStop={finishResize}
      style={{ zIndex: 0, cursor: canEdit ? 'grab' : 'default' }}
    >
      <div
        className="table-item"
        aria-label="桌子"
        draggable={false}
        style={{
          position: 'absolute',
          left: frame.offsetX,
          top: frame.offsetY,
          width: geometry.width,
          height: geometry.height,
          transform: `rotate(${table.rotation}deg)`,
          transformOrigin: 'center',
          boxSizing: 'border-box',
          touchAction: isEditing ? 'none' : 'auto',
        }}
      >
        {onRemove && (
          <button
            type="button"
            className="canvas-delete"
            aria-label="删除桌子"
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
