import { UserRole } from '../shared';
import { useAuth } from './AuthContext';

export function useRole() {
  const { user } = useAuth();
  const role = user?.role ?? null;
  return {
    role,
    canEdit: role === UserRole.ADMIN || role === UserRole.EDITOR,
    isAdmin: role === UserRole.ADMIN,
  };
}
