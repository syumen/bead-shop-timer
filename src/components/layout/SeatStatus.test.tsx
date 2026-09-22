import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Seat, Session } from '../../db/models';
import SeatItem from './SeatItem';
import SeatStatus, { formatElapsedTime, mapActiveSessionsBySeat } from './SeatStatus';

const startedAt = 1_700_000_000_000;
const activeSession: Session = {
  id: 'session-a',
  seatId: 'seat-a',
  startedAt,
  endedAt: null,
  status: 'active',
  createdAt: startedAt,
  updatedAt: startedAt,
};

describe('mapActiveSessionsBySeat', () => {
  it('按 seatId 匹配 active Session，忽略 completed Session', () => {
    const otherActive: Session = { ...activeSession, id: 'session-b', seatId: 'seat-b' };
    const completed: Session = {
      ...activeSession,
      id: 'completed-a',
      status: 'completed',
      endedAt: startedAt + 1_000,
    };

    const bySeat = mapActiveSessionsBySeat([
      otherActive,
      activeSession,
      completed,
      { ...completed, id: 'completed-c', seatId: 'seat-c' },
    ]);

    expect(bySeat.size).toBe(2);
    expect(bySeat.get('seat-a')).toEqual(activeSession);
    expect(bySeat.get('seat-b')).toEqual(otherActive);
    expect(bySeat.has('seat-c')).toBe(false);
    expect(bySeat.has('missing')).toBe(false);
  });
});

describe('formatElapsedTime', () => {
  it.each([
    { elapsed: 0, expected: '00:00:00' },
    { elapsed: 999, expected: '00:00:00' },
    { elapsed: 1_000, expected: '00:00:01' },
    { elapsed: 3_661_000, expected: '01:01:01' },
    { elapsed: 86_400_000, expected: '24:00:00' },
    { elapsed: -1_000, expected: '00:00:00' },
  ])('将 $elapsed 毫秒显示为 $expected', ({ elapsed, expected }) => {
    expect(formatElapsedTime(startedAt, startedAt + elapsed)).toBe(expected);
  });
});

describe('SeatStatus', () => {
  it('有 active Session 的座位显示座位名称和对应的已计时时长', () => {
    const bySeat = mapActiveSessionsBySeat([
      { ...activeSession, id: 'session-b', seatId: 'seat-b', startedAt: startedAt + 10_000 },
      activeSession,
    ]);
    const first = renderToStaticMarkup(
      <SeatStatus seatNumber={1} activeSession={bySeat.get('seat-a')} now={startedAt + 3_661_000} />,
    );
    const second = renderToStaticMarkup(
      <SeatStatus seatNumber={2} activeSession={bySeat.get('seat-b')} now={startedAt + 3_661_000} />,
    );

    expect(first).toContain('座位 1');
    expect(first).toContain('01:01:01');
    expect(first).not.toContain('空闲');
    expect(second).toContain('座位 2');
    expect(second).toContain('01:00:51');
  });

  it('空闲座位显示空闲，不显示计时时长', () => {
    const bySeat = mapActiveSessionsBySeat([activeSession]);
    const markup = renderToStaticMarkup(
      <SeatStatus seatNumber={3} activeSession={bySeat.get('seat-c')} now={startedAt + 3_661_000} />,
    );

    expect(markup).toContain('座位 3');
    expect(markup).toContain('空闲');
    expect(markup).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('新时间值或页面重新渲染时，根据原始 startedAt 重新计算', () => {
    const renderAt = (now: number) => renderToStaticMarkup(
      <SeatStatus seatNumber={1} activeSession={activeSession} now={now} />,
    );

    expect(renderAt(startedAt + 5_000)).toContain('00:00:05');
    expect(renderAt(startedAt + 6_000)).toContain('00:00:06');
    expect(renderAt(startedAt + 90_000)).toContain('00:01:30');
    expect(activeSession.startedAt).toBe(startedAt);
    expect(activeSession.updatedAt).toBe(startedAt);
  });

  it('编辑模式保留编号和删除控件，不显示实时计时或空闲内容', () => {
    const seat: Seat = {
      id: 'seat-a', seatNumber: 1, x: 80, y: 80, width: 64, height: 64,
      rotation: 0, isActive: true, createdAt: startedAt, updatedAt: startedAt,
    };
    const markup = renderToStaticMarkup(
      <SeatItem
        seat={seat}
        activeSession={activeSession}
        now={startedAt + 3_661_000}
        isEditing
        onPositionChange={async () => true}
        onRemove={() => {}}
      />,
    );

    expect(markup).toContain('<span>1</span>');
    expect(markup).toContain('删除座位 1');
    expect(markup).not.toContain('空闲');
    expect(markup).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});
