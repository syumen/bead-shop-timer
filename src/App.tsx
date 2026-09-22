import { useState } from 'react';
import LayoutCanvas from './components/layout/LayoutCanvas';
import LogsPage from './pages/LogsPage';
import StatsPage from './pages/StatsPage';

export default function App() {
  const [page, setPage] = useState<'business' | 'logs' | 'stats'>('business');

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <span className="app-name">拼豆店计时</span>
          <nav aria-label="页面切换" className="main-nav">
            <button type="button" aria-pressed={page === 'business'} onClick={() => setPage('business')}>
              营业
            </button>
            <button type="button" aria-pressed={page === 'logs'} onClick={() => setPage('logs')}>
              操作记录
            </button>
            <button type="button" aria-pressed={page === 'stats'} onClick={() => setPage('stats')}>
              经营统计
            </button>
          </nav>
        </div>
      </header>
      <div className="app-content">
        {page === 'business' && <LayoutCanvas />}
        {page === 'logs' && <LogsPage />}
        {page === 'stats' && <StatsPage />}
      </div>
    </>
  );
}
