import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useRole } from '../../auth/useRole';
import './AdminLayout.css';

const ShieldIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const MenuIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

function AdminSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <aside id="admin-sidebar" className={`admin-sidebar${open ? ' open' : ''}`} aria-label="Admin navigation">
      {/* Header */}
      <div className="admin-sidebar-header">
        <div className="admin-sidebar-icon">
          <ShieldIcon />
        </div>
        <div className="admin-sidebar-title-container">
          <div className="admin-sidebar-title">Admin Panel</div>
          <div className="admin-sidebar-subtitle">Ozellar Marine</div>
        </div>
        <button type="button" className="admin-sidebar-close" aria-label="Close menu" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>

      {/* Back link */}
      <NavLink to="/tracker" className="admin-back-link" onClick={onClose}>
        <ChevronLeftIcon />
        Back to App
      </NavLink>

      {/* Nav sections */}
      <div className="admin-nav-sections" onClick={onClose}>
        <NavLink to="/admin/users" end className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
          All Users
        </NavLink>
        <NavLink to="/admin/vessels" end className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
          All Vessels
        </NavLink>
        <NavLink to="/admin/vendor-mapping" end className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
          Vendor Mapping
        </NavLink>
        <NavLink to="/admin/vendors" end className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
          All Vendors
        </NavLink>
        <NavLink to="/admin/owner-recipients" end className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
          Owner Recipients
        </NavLink>
      </div>
    </aside>
  );
}

export function AdminLayout() {
  const { isAdmin } = useRole();
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close the drawer whenever the route changes
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // While open: close on Escape and lock background scroll
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  // Reset the drawer if the screen grows to desktop width (e.g. rotating a tablet)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setSidebarOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  if (!isAdmin) {
    return <Navigate to="/tracker" replace />;
  }

  return (
    <div className="admin-shell">
      {/* Top bar with hamburger (phones and tablets only) */}
      <header className="admin-topbar">
        <button
          type="button"
          className="admin-menu-btn"
          aria-label="Open menu"
          aria-expanded={sidebarOpen}
          aria-controls="admin-sidebar"
          onClick={() => setSidebarOpen(true)}
        >
          <MenuIcon />
        </button>
        <div className="admin-topbar-title">Admin Panel</div>
      </header>

      <div
        className={`admin-backdrop${sidebarOpen ? ' visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="admin-content">
        <Outlet />
      </div>
    </div>
  );
}