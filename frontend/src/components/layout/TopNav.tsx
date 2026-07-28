import { NavLink } from 'react-router-dom';
import { UserMenu } from './UserMenu';

export function TopNav() {
  return (
    <header className="top-nav">
      <div className="brand">PI Follow-up Tracker</div>
      <nav>
        <NavLink to="/dashboard" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          Dashboard
        </NavLink>
        <NavLink to="/tracker" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          Tracker
        </NavLink>
        <NavLink to="/feed" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          Feed
        </NavLink>
      </nav>
      <UserMenu />
    </header>
  );
}
