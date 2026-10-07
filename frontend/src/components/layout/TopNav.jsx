import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
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
  const { canAccessPi, canAccessPir, canAccessSoa, canAccessLanding } = useRole();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Close on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  // Close if the viewport grows to desktop while open
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      if (mq.matches) setMenuOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const closeMenu = () => setMenuOpen(false);
  const linkClass = ({ isActive }) =>
    `marine-nav-link${isActive ? ' active' : ''}`;

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

        {/* Navigation links (inline on desktop, right-side drawer on mobile/tablet) */}
        <nav
          id="marine-topnav-links"
          className={`marine-topnav-links${menuOpen ? ' open' : ''}`}
        >
          {/* Drawer header (mobile/tablet only) */}
          <div className="marine-drawer-head">
            <span className="marine-drawer-title">Menu</span>
            <button
              type="button"
              className="marine-drawer-close"
              aria-label="Close menu"
              onClick={closeMenu}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {canAccessPi && (
            <>
              <NavLink to="/dashboard" className={linkClass} onClick={closeMenu}>Dashboard</NavLink>
              <NavLink to="/tracker"   className={linkClass} onClick={closeMenu}>Tracker</NavLink>
              <NavLink to="/feed"      className={linkClass} onClick={closeMenu}>Feed</NavLink>
            </>
          )}
          {canAccessPir && (
            <NavLink to="/pir" className={linkClass} onClick={closeMenu}>PIR</NavLink>
          )}
          {canAccessSoa && (
            <NavLink to="/soa" className={linkClass} onClick={closeMenu}>SOA</NavLink>
          )}
          {canAccessLanding && (
            <NavLink to="/landing-reports" className={linkClass} onClick={closeMenu}>Landing Reports</NavLink>
          )}
        </nav>

        {/* User profile pill */}
        <div className="marine-topnav-actions">
          <UserMenu />
        </div>

        {/* Hamburger (mobile + tablet only, far right) */}
        <button
          type="button"
          className="marine-topnav-hamburger"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="marine-topnav-links"
          onClick={() => setMenuOpen(true)}
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      {/* Backdrop behind the drawer */}
      <div
        className={`marine-topnav-backdrop${menuOpen ? ' open' : ''}`}
        onClick={closeMenu}
        aria-hidden="true"
      />
    </div>
  );
}