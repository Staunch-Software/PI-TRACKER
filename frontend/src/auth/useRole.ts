import { UserRole } from '../shared';
import { useAuth } from './AuthContext';

export function useRole() {
  const { user } = useAuth();
  const role = user?.role ?? null;
  const isAdmin = role === UserRole.ADMIN;
  return {
    role,
    canEdit: role === UserRole.ADMIN || role === UserRole.EDITOR,
    isAdmin,
    // ADMIN always has full module access regardless of the per-user flags — mirrors
    // backend/app/api/deps.py require_module_access, so an admin can never lock themselves out
    // by unchecking their own boxes, and hiding a nav link always matches what the API allows.
    canAccessPi: isAdmin || (user?.canAccessPi ?? false),
    canAccessPir: isAdmin || (user?.canAccessPir ?? false),
    canAccessSoa: isAdmin || (user?.canAccessSoa ?? false),
  };
}
