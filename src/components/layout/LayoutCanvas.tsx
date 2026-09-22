import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import { db } from '../../db/database';
import type { Seat, Session } from '../../db/models';
import { useCurrentTime } from '../../hooks/useCurrentTime';
import {
  addSeat,
  addTable,
  LAYOUT_HEIGHT,
  LAYOUT_WIDTH,
  removeSeat,
  removeTable,
  updateSeatPosition,
  updateTableLayout,
  updateTablePosition,
} from '../../services/layoutService';
import { endSession, startSession } from '../../services/sessionService';
import EndSessionPanel from './EndSessionPanel';
import SeatItem from './SeatItem';
import { mapActiveSessionsBySeat } from './SeatStatus';
import StartSessionPanel from './StartSessionPanel';
import TableItem from './TableItem';
import TodayCompletedSessions from './TodayCompletedSessions';

type SelectedPanel =
  | { type: 'start'; seatId: string }
  | { type: 'end'; seatId: string; sessionId: string }
  | { type: 'result'; seatId: string; seatNumber: number; session: Session };

export default function LayoutCanvas() {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPanel, setSelectedPanel] = useState<SelectedPanel | null>(null);
  const [pendingAction, setPendingAction] = useState<'start' | 'end' | null>(null);
  const sessionPending = useRef(false);
  const layout = useLiveQuery(async () => {
    const [seats, tables, activeSessions] = await Promise.all([
      db.seats.filter((seat) => seat.isActive === true).toArray(),
      db.layoutTables.filter((table) => table.isActive === true).toArray(),
      db.sessions.filter((session) => session.status === 'active').toArray(),
    ]);

    return { seats, tables, activeSessions };
  }, []);
  const sessionsBySeat = useMemo(
    () => mapActiveSessionsBySeat(layout?.activeSessions ?? []),
    [layout?.activeSessions],
  );
  const now = useCurrentTime(!isEditing && sessionsBySeat.size > 0);
  const selectedSeat = layout?.seats.find((seat) => seat.id === selectedPanel?.seatId);
  const selectedSession = selectedPanel?.type === 'end'
    ? layout?.activeSessions.find((session) => session.id === selectedPanel.sessionId)
    : undefined;
  const endPanelSession = selectedPanel?.type === 'result' ? selectedPanel.session : selectedSession;
  const endPanelSeatNumber = selectedPanel?.type === 'result' ? selectedPanel.seatNumber : selectedSeat?.seatNumber;
  const isSessionPanelVisible = !isEditing && (selectedPanel?.type === 'result'
    || (Boolean(selectedSeat) && (selectedPanel?.type === 'start' || Boolean(selectedSession))));

  function openSeatPanel(seatId: string) {
    if (isEditing || isSaving || sessionPending.current) return;
    const activeSession = sessionsBySeat.get(seatId);
    setError(null);
    setSelectedPanel(activeSession
      ? { type: 'end', seatId, sessionId: activeSession.id }
      : { type: 'start', seatId });
  }

  async function confirmStart() {
    if (isEditing || selectedPanel?.type !== 'start' || !selectedSeat
      || sessionPending.current || sessionsBySeat.has(selectedSeat.id)) return;

    sessionPending.current = true;
    setPendingAction('start');
    setError(null);
    try {
      await startSession(selectedSeat.id);
      setSelectedPanel(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '开始计时失败，请重试');
    } finally {
      sessionPending.current = false;
      setPendingAction(null);
    }
  }

  async function confirmEnd() {
    if (isEditing || selectedPanel?.type !== 'end' || !selectedSession || !selectedSeat || sessionPending.current) return;

    sessionPending.current = true;
    setPendingAction('end');
    setError(null);
    try {
      const completed = await endSession(selectedSession.id);
      setSelectedPanel({ type: 'result', seatId: completed.seatId, seatNumber: selectedSeat.seatNumber, session: completed });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '结束计时失败，请重试');
    } finally {
      sessionPending.current = false;
      setPendingAction(null);
    }
  }

  async function runAction(action: () => Promise<unknown>) {
    setError(null);
    setIsSaving(true);

    try {
      await action();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试');
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  function handleRemoveSeat(seat: Seat) {
    if (window.confirm(`确定删除 ${seat.seatNumber} 号座位吗？`)) {
      void runAction(() => removeSeat(seat.id));
    }
  }

  return (
    <main className="page business-page">
      <header className="page-heading business-heading">
        <div>
          <h1>{isEditing ? '布局编辑' : '营业'}</h1>
          {isEditing && <p className="editing-status" role="status">正在编辑布局</p>}
        </div>
        {!isEditing && (
          <div className="visitor-summary" aria-label="当前在店人数">
            <span>当前在店人数</span>
            <strong>{layout ? layout.activeSessions.length : '—'}<small>人</small></strong>
          </div>
        )}
        <div className="layout-toolbar" role="group" aria-label="布局工具栏">
          {isEditing && (
            <>
              <button type="button" disabled={isSaving} onClick={() => void runAction(addSeat)}>
                添加座位
              </button>
              <button type="button" disabled={isSaving} onClick={() => void runAction(addTable)}>
                添加桌子
              </button>
            </>
          )}
          <button
            type="button"
            className={isEditing ? 'button-primary' : undefined}
            aria-pressed={isEditing}
            disabled={isSaving || pendingAction !== null}
            onClick={() => {
              if (sessionPending.current) return;
              setIsEditing(!isEditing);
              setSelectedPanel(null);
              setError(null);
            }}
          >
            {isEditing ? '完成编辑' : '编辑布局'}
          </button>
        </div>
      </header>
      {error && !isSessionPanelVisible && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {!isEditing && selectedSeat && selectedPanel?.type === 'start' && (
        <StartSessionPanel
          seatNumber={selectedSeat.seatNumber}
          hasActiveSession={sessionsBySeat.has(selectedSeat.id)}
          isStarting={pendingAction === 'start'}
          error={error}
          onStart={() => void confirmStart()}
          onCancel={() => setSelectedPanel(null)}
        />
      )}
      {!isEditing && endPanelSeatNumber !== undefined && endPanelSession && (
        <EndSessionPanel
          key={endPanelSession.id}
          seatNumber={endPanelSeatNumber}
          session={endPanelSession}
          now={now}
          isEnding={pendingAction === 'end'}
          error={error}
          onConfirm={() => void confirmEnd()}
          onClose={() => setSelectedPanel(null)}
        />
      )}
      <div className="canvas-viewport" role="region" aria-label="平面图滚动区域" tabIndex={0}>
        <div
          role="region"
          aria-label="店铺平面图"
          className="layout-canvas"
          style={{
            width: LAYOUT_WIDTH,
            height: LAYOUT_HEIGHT,
          }}
        >
          {layout?.tables.map((table) => (
            <TableItem
              key={table.id}
              table={table}
              isEditing={isEditing}
              isSaving={isSaving}
              onPositionChange={(x, y) => runAction(() => updateTablePosition(table.id, x, y))}
              onLayoutChange={(next) => runAction(() => updateTableLayout(table.id, next))}
              onRemove={isEditing ? () => void runAction(() => removeTable(table.id)) : undefined}
            />
          ))}
          {layout?.seats.map((seat) => (
            <SeatItem
              key={seat.id}
              seat={seat}
              activeSession={sessionsBySeat.get(seat.id)}
              now={now}
              isEditing={isEditing}
              isSaving={isSaving || pendingAction !== null}
              onSelect={() => openSeatPanel(seat.id)}
              onPositionChange={(x, y) => runAction(() => updateSeatPosition(seat.id, x, y))}
              onRemove={isEditing ? () => handleRemoveSeat(seat) : undefined}
            />
          ))}
          {!layout && (
            <p role="status" className="empty-state">
              正在加载布局…
            </p>
          )}
          {layout && layout.seats.length === 0 && layout.tables.length === 0 && (
            <p role="status" className="empty-state">
              暂无座位，请进入布局编辑添加
            </p>
          )}
        </div>
      </div>
      {!isEditing && <TodayCompletedSessions />}
    </main>
  );
}
