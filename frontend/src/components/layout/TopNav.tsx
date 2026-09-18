import { NavLink } from 'react-router-dom';
import { useRole } from '../../auth/useRole';
import { UserMenu } from './UserMenu';

export function TopNav() {
  const { canAccessPi, canAccessPir } = useRole();

  return (
    <header className="top-nav">
      <div className="brand">PI Follow-up Tracker</div>
      <nav>
        {canAccessPi && (
          <>
            <NavLink to="/dashboard" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              Dashboard
            </NavLink>
            <NavLink to="/tracker" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              Tracker
            </NavLink>
            <NavLink to="/feed" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              Feed
            </NavLink>
          </>
        )}
        {canAccessPir && (
          <NavLink to="/pir" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            PIR
          </NavLink>
        )}
      </nav>
      <UserMenu />
    </header>
  );
}
