import { Link, Navigate, NavLink, Outlet } from 'react-router-dom';
import { useRole } from '../../auth/useRole';
import { AdminCreateModalProvider, useAdminCreateModal } from './AdminCreateModalContext';

function AdminSidebar() {
  const { isUsersCreateOpen, isVesselsCreateOpen } = useAdminCreateModal();

  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar-header">
        <span className="admin-shield">🛡</span>
        <span>Admin Panel</span>
      </div>
      <NavLink to="/tracker" className="admin-back-link">
        ← Back to Tracker
      </NavLink>

      <div className="admin-nav-section">
        <div className="admin-nav-heading">Users</div>
        <NavLink to="/admin/users" end className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
          All Users
        </NavLink>
        <Link to="/admin/users?new=1" className={`admin-nav-link create${isUsersCreateOpen ? ' active' : ''}`}>
          + Create User
        </Link>
      </div>

      <div className="admin-nav-section">
        <div className="admin-nav-heading">Vessels</div>
        <NavLink to="/admin/vessels" end className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
          All Vessels
        </NavLink>
        <Link to="/admin/vessels?new=1" className={`admin-nav-link create${isVesselsCreateOpen ? ' active' : ''}`}>
          + Create Vessel
        </Link>
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
    <AdminCreateModalProvider>
      <div className="admin-shell">
        <AdminSidebar />
        <div className="admin-content">
          <Outlet />
        </div>
      </div>
    </AdminCreateModalProvider>
  );
}
