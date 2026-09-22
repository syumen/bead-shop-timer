interface StartSessionPanelProps {
  seatNumber: number;
  hasActiveSession: boolean;
  isStarting: boolean;
  error?: string | null;
  onStart: () => void;
  onCancel: () => void;
}

export default function StartSessionPanel({
  seatNumber,
  hasActiveSession,
  isStarting,
  error,
  onStart,
  onCancel,
}: StartSessionPanelProps) {
  return (
    <section
      role="dialog"
      aria-labelledby="start-session-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !isStarting) onCancel();
      }}
      className="session-panel"
    >
      <h2 id="start-session-title">
        座位 {seatNumber}
      </h2>
      <p className="session-details">当前状态：{hasActiveSession ? '计时中' : '空闲'}</p>
      {error && <p role="alert" className="error-message">{error}</p>}
      <div className="panel-actions">
        {!hasActiveSession && (
          <button type="button" className="button-primary" autoFocus disabled={isStarting} onClick={onStart}>
            {isStarting ? '正在开始…' : '开始计时'}
          </button>
        )}
        <button type="button" disabled={isStarting} onClick={onCancel}>
          取消
        </button>
      </div>
    </section>
  );
}
