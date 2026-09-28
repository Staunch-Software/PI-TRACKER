import { NavLink, Navigate, Outlet } from 'react-router-dom';
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

function AdminSidebar() {
  return (
    <aside className="admin-sidebar">
      {/* Header */}
      <div className="admin-sidebar-header">
        <div className="admin-sidebar-icon">
          <ShieldIcon />
        </div>
        <div className="admin-sidebar-title-container">
          <div className="admin-sidebar-title">Admin Panel</div>
          <div className="admin-sidebar-subtitle">Ozellar Marine</div>
        </div>
      </div>

      {/* Back link */}
      <NavLink to="/tracker" className="admin-back-link">
        <ChevronLeftIcon />
        Back to App
      </NavLink>

      {/* Nav sections */}
      <div className="admin-nav-sections">
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

  if (!isAdmin) {
    return <Navigate to="/tracker" replace />;
  }

  return (
    <div className="admin-shell">
      <AdminSidebar />
      <div className="admin-content">
        <Outlet />
      </div>
    </div>
  );
}
