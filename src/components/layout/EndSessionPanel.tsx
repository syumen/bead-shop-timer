import { useState } from 'react';
import type { Session } from '../../db/models';
import { formatElapsedTime } from './SeatStatus';

interface EndSessionPanelProps {
  seatNumber: number;
  session: Session;
  now: number;
  isEnding: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export default function EndSessionPanel({
  seatNumber,
  session,
  now,
  isEnding,
  error,
  onConfirm,
  onClose,
}: EndSessionPanelProps) {
  const [isConfirming, setIsConfirming] = useState(false);

  return (
    <section
      role="dialog"
      aria-labelledby="end-session-title"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || isEnding) return;
        if (isConfirming) setIsConfirming(false);
        else onClose();
      }}
      className="session-panel"
    >
      <h2 id="end-session-title">
        座位 {seatNumber}
      </h2>
      <div className="session-details">
        <p>
          开始时间：
          <time dateTime={new Date(session.startedAt).toISOString()}>
            {new Date(session.startedAt).toLocaleString('zh-CN', { hour12: false })}
          </time>
        </p>
        <p>当前已用时：<strong>{formatElapsedTime(session.startedAt, now)}</strong></p>
      </div>
      {error && <p role="alert" className="error-message">{error}</p>}
      {isConfirming ? (
        <div className="confirmation-box">
          <p className="confirmation-text">确认结束座位 {seatNumber} 的计时？</p>
          <div className="panel-actions">
            <button type="button" className="button-primary" disabled={isEnding} onClick={onConfirm}>
              {isEnding ? '正在结束…' : '确认结束'}
            </button>
            <button type="button" autoFocus disabled={isEnding} onClick={() => setIsConfirming(false)}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="panel-actions">
          <button type="button" className="button-primary" disabled={isEnding} onClick={() => setIsConfirming(true)}>
            结束计时
          </button>
          <button type="button" autoFocus disabled={isEnding} onClick={onClose}>
            关闭
          </button>
        </div>
      )}
    </section>
  );
}
