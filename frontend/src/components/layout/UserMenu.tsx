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
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
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
    <div className="user-menu-wrapper" ref={menuRef}>
      <button className="user-menu-trigger" onClick={() => setIsOpen((v) => !v)}>
        <span className="user-avatar">{initials}</span>
        <span className="user-menu-info">
          <span className="user-menu-name">{user.fullName}</span>
          <span className="user-menu-role">{user.role}</span>
        </span>
        <span className="user-menu-caret">▾</span>
      </button>
      {isOpen && (
        <div className="user-menu-dropdown">
          <div className="user-menu-dropdown-header">
            <span className="user-avatar">{initials}</span>
            <div>
              <div className="user-menu-name">{user.fullName}</div>
              <div className="user-menu-email">{user.email}</div>
              <span className="role-pill">{user.role}</span>
            </div>
          </div>
          {isAdmin && (
            <button
              className="user-menu-item"
              onClick={() => {
                setIsOpen(false);
                navigate('/admin');
              }}
            >
              Admin Panel
            </button>
          )}
          <button
            className="user-menu-item"
            onClick={() => {
              setIsOpen(false);
              setIsChangingPassword(true);
            }}
          >
            Change Password
          </button>
          <button className="user-menu-item danger" onClick={() => logout()}>
            Log out
          </button>
        </div>
      )}
      {isChangingPassword && <ChangePasswordModal onClose={() => setIsChangingPassword(false)} />}
    </div>
  );
}
