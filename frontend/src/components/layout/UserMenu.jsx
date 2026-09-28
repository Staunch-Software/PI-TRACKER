import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useRole } from '../../auth/useRole';
import { ChangePasswordModal } from '../modals/ChangePasswordModal';

export function UserMenu() {
  const { user, logout } = useAuth();
  const { isAdmin } = useRole();
  const [isOpen, setIsOpen] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) return null;

  const initials = user.fullName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="marine-user-menu-wrapper" ref={menuRef}>
      <button className="marine-user-menu-trigger" onClick={() => setIsOpen((v) => !v)}>
        <div className="marine-user-avatar-pill">
          <span className="marine-user-avatar">{initials}</span>
          <span className="marine-user-menu-info">
            <span className="marine-user-menu-name">{user.fullName}</span>
            <span className="marine-user-menu-role">{user.role}</span>
          </span>
          <svg className={`marine-user-caret ${isOpen ? 'open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </button>
      
      {isOpen && (
        <div className="marine-user-dropdown">
          <div className="marine-dropdown-header">
            <span className="marine-user-avatar lg">{initials}</span>
            <div className="marine-dropdown-header-info">
              <div className="marine-dropdown-name">{user.fullName}</div>
              <div className="marine-dropdown-email">{user.email}</div>
              <span className="marine-role-badge">{user.role}</span>
            </div>
          </div>
          <div className="marine-dropdown-body">
            {isAdmin && (
              <button className="marine-dropdown-item" onClick={() => { setIsOpen(false); navigate('/admin'); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
                Admin Panel
              </button>
            )}
            <button className="marine-dropdown-item" onClick={() => { setIsOpen(false); setIsChangingPassword(true); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Change Password
            </button>
            <div className="marine-dropdown-divider"></div>
            <button className="marine-dropdown-item danger" onClick={() => logout()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sign Out
            </button>
          </div>
        </div>
      )}
      {isChangingPassword && <ChangePasswordModal onClose={() => setIsChangingPassword(false)} />}
    </div>
  );
}
