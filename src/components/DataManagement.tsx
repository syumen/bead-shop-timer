import { useRef, useState, type ChangeEvent } from 'react';
import { exportBackup, importBackup } from '../services/backupService';

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('无法读取备份文件，请重试'));
    reader.onabort = () => reject(new Error('备份文件读取已取消'));
    reader.readAsText(file);
  });
}

function fileTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export default function DataManagement() {
  const fileInput = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ data: unknown; name: string } | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '数据操作失败，请重试');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function downloadBackup() {
    await run(async () => {
      const backup = await exportBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      try {
        link.href = url;
        link.download = `拼豆店备份_${fileTimestamp(backup.exportedAt)}.json`;
        document.body.append(link);
        link.click();
        setMessage('备份文件已生成，请在浏览器下载中查看');
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
  }

  async function selectBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    await run(async () => {
      setPending(null);
      const text = await readFile(file);
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('备份格式无效，请选择有效的 JSON 备份文件');
      }
      setPending({ data, name: file.name });
    });
  }

  async function confirmImport() {
    if (!pending) return;
    await run(async () => {
      await importBackup(pending.data);
      setPending(null);
      setMessage('备份导入完成');
    });
  }

  return (
    <section aria-labelledby="data-management-title" className="data-management session-panel">
      <h2 id="data-management-title">数据管理</h2>
      <div className="panel-actions">
        <button type="button" disabled={busy || pending !== null} onClick={downloadBackup}>导出备份</button>
        <button type="button" disabled={busy || pending !== null} onClick={() => fileInput.current?.click()}>导入备份</button>
        <input ref={fileInput} type="file" accept=".json,application/json" aria-label="选择 JSON 备份文件" hidden disabled={busy} onChange={selectBackup} />
      </div>
      {pending && (
        <div role="dialog" aria-labelledby="import-confirmation" className="confirmation-box">
          <p>已选择：{pending.name}</p>
          <p id="import-confirmation" className="confirmation-text">导入备份将覆盖当前全部数据，是否继续？</p>
          <div className="panel-actions">
            <button type="button" className="button-primary" disabled={busy} onClick={confirmImport}>
              {busy ? '正在导入…' : '确认导入'}
            </button>
            <button type="button" autoFocus disabled={busy} onClick={() => { setPending(null); setError(''); }}>取消</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="error-message">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
