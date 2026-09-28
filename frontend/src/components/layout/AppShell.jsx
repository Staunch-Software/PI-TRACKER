import { Outlet } from 'react-router-dom';
import { TopNav } from './TopNav';

export function AppShell() {
  return (
    <div className="app-shell">
      <TopNav />
      <main className="page-content">
        <Outlet />
      </main>
    </div>
  );
}
