import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import EndSessionPanel from '../components/layout/EndSessionPanel';
import type { Session } from '../db/models';
import { formatSessionDuration } from './sessionDuration';

it.each([
  [0, '0分钟'], [59_999, '0分钟'], [38 * 60_000, '38分钟'],
  [60 * 60_000, '1小时 0分钟'], [106 * 60_000 + 59_999, '1小时 46分钟'],
  [25 * 60 * 60_000, '25小时 0分钟'], [-1, '时长异常'], [null, '时长异常'],
] as const)('时长 %s 格式化为 %s', (duration, expected) => {
  expect(formatSessionDuration({ startedAt: 0, endedAt: duration })).toBe(expected);
});

it('结束结果只使用 endedAt - startedAt，当前时间继续变化不会改变本次总时长', () => {
  const session: Session = {
    id: 'completed', seatId: 'seat', status: 'completed', startedAt: 1000,
    endedAt: 1000 + 38 * 60_000, createdAt: 1000, updatedAt: 1000 + 38 * 60_000,
  };
  const render = (now: number) => renderToStaticMarkup(
    <EndSessionPanel seatNumber={7} session={session} now={now} isEnding={false} onConfirm={() => {}} onClose={() => {}} />,
  );
  const original = render(session.endedAt!);
  expect(original).toContain('38分钟');
  expect(render(session.endedAt! + 3_600_000)).toBe(original);
});
