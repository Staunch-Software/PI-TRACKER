import { NavLink } from 'react-router-dom';
import { useRole } from '../../auth/useRole';
import { UserMenu } from './UserMenu';
import './TopNav.css';

const AnchorIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="marine-topnav-logo">
    <circle cx="12" cy="5" r="3" />
    <line x1="12" y1="22" x2="12" y2="8" />
    <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
  </svg>
);

export function TopNav() {
  const { canAccessPi, canAccessPir, canAccessSoa } = useRole();

  return (
    <div className="marine-topnav-container">
      <header className="marine-topnav">
        {/* Brand */}
        <div className="marine-topnav-brand">
          <AnchorIcon />
          <span>PI Tracker</span>
        </div>

        {/* Vertical divider */}
        <div className="marine-topnav-divider" />

        {/* Navigation links */}
        <nav className="marine-topnav-links">
          {canAccessPi && (
            <>
              <NavLink to="/dashboard" className={({ isActive }) => `marine-nav-link${isActive ? ' active' : ''}`}>Dashboard</NavLink>
              <NavLink to="/tracker"   className={({ isActive }) => `marine-nav-link${isActive ? ' active' : ''}`}>Tracker</NavLink>
              <NavLink to="/feed"      className={({ isActive }) => `marine-nav-link${isActive ? ' active' : ''}`}>Feed</NavLink>
            </>
          )}
          {canAccessPir && (
            <NavLink to="/pir" className={({ isActive }) => `marine-nav-link${isActive ? ' active' : ''}`}>PIR</NavLink>
          )}
          {canAccessSoa && (
            <NavLink to="/soa" className={({ isActive }) => `marine-nav-link${isActive ? ' active' : ''}`}>SOA</NavLink>
          )}
        </nav>

        {/* User profile pill */}
        <div className="marine-topnav-actions">
          <UserMenu />
        </div>
      </header>
    </div>
  );
}
