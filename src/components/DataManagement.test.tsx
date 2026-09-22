// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../db/database';
import StatsPage from '../pages/StatsPage';
import * as backupService from '../services/backupService';
import { addSeat } from '../services/layoutService';
import { startSession } from '../services/sessionService';

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
let container: HTMLDivElement;
let root: Root;
const emptyBackup = { version: 1, exportedAt: 100, seats: [], tables: [], sessions: [], operationLogs: [] };

beforeAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  await db.delete();
  await db.open();
  const seat = await addSeat();
  await startSession(seat.id);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<StatsPage />));
  await waitForUI(() => expect(container.querySelector('dl')?.textContent).toContain('当前在店人数1人'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await db.delete();
});
afterAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment; });

async function waitForUI(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    assertion();
  }, { timeout: 2000, interval: 10 });
}

function button(text: string) {
  const found = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === text);
  if (!found) throw new Error(`未找到按钮：${text}`);
  return found;
}

async function chooseFile(text: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], '恢复.json', { type: 'application/json' })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

async function snapshot() {
  const { exportedAt: _exportedAt, ...data } = await backupService.exportBackup();
  return data;
}

it('选择文件后显示明确二次确认，确认前及取消后均不修改任何数据', async () => {
  const original = await snapshot();
  const importSpy = vi.spyOn(backupService, 'importBackup');
  await chooseFile(JSON.stringify(emptyBackup));
  await waitForUI(() => expect(container.textContent).toContain('导入备份将覆盖当前全部数据，是否继续？'));
  expect(importSpy).not.toHaveBeenCalled();
  expect(await snapshot()).toEqual(original);
  await act(async () => button('取消').click());
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(importSpy).not.toHaveBeenCalled();
  expect(await snapshot()).toEqual(original);
});

it('二次确认后才调用导入，成功提示完成，统计实时反映恢复后的数据', async () => {
  const importSpy = vi.spyOn(backupService, 'importBackup');
  await chooseFile(JSON.stringify(emptyBackup));
  await waitForUI(() => expect(container.querySelector('[role="dialog"]')).not.toBeNull());
  await act(async () => button('确认导入').click());
  await waitForUI(() => {
    expect(container.textContent).toContain('备份导入完成');
    expect(container.querySelector('dl')?.textContent).toContain('当前在店人数0人');
  });
  expect(importSpy).toHaveBeenCalledExactlyOnceWith(emptyBackup);
  expect(await db.sessions.count()).toBe(0);
  expect(await db.operationLogs.count()).toBe(0);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it('非法 JSON 显示错误，不显示确认且不修改数据', async () => {
  const original = await snapshot();
  await chooseFile('{broken');
  await waitForUI(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('JSON'));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(await snapshot()).toEqual(original);
});

it('有效 JSON 但版本无效时，确认导入后显示错误且保留原数据', async () => {
  const original = await snapshot();
  await chooseFile(JSON.stringify({ ...emptyBackup, version: 2 }));
  await waitForUI(() => expect(container.querySelector('[role="dialog"]')).not.toBeNull());
  await act(async () => button('确认导入').click());
  await waitForUI(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('不支持此备份版本'));
  expect(await snapshot()).toEqual(original);
});

it('提交期间禁止重复确认，导入失败显示错误并保留数据库', async () => {
  const original = await snapshot();
  let rejectImport!: (reason: Error) => void;
  const importSpy = vi.spyOn(backupService, 'importBackup').mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectImport = reject; }));
  await chooseFile(JSON.stringify(emptyBackup));
  await waitForUI(() => expect(container.querySelector('[role="dialog"]')).not.toBeNull());
  const confirm = button('确认导入');
  await act(async () => { confirm.click(); confirm.click(); });
  expect(importSpy).toHaveBeenCalledTimes(1);
  expect(button('正在导入…').disabled).toBe(true);
  expect(button('取消').disabled).toBe(true);
  await act(async () => rejectImport(new Error('模拟存储写入失败')));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('模拟存储写入失败');
  expect(await snapshot()).toEqual(original);
});

it('导出生成包含本地日期时间的 JSON 下载文件，四张表内容完整', async () => {
  const original = await snapshot();
  const now = new Date(2026, 8, 21, 14, 5, 9).getTime();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:backup-test');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  let filename = '';
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
  await act(async () => button('导出备份').click());
  await waitForUI(() => expect(container.textContent).toContain('备份文件已生成'));
  expect(filename).toBe('拼豆店备份_2026-09-21_14-05-09.json');
  const blob = createObjectURL.mock.calls[0][0];
  expect(blob.type).toBe('application/json');
  const text = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
  expect(JSON.parse(text)).toEqual({ ...original, exportedAt: now });
  expect(await snapshot()).toEqual(original);
  await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup-test'), { timeout: 2000 });
});
