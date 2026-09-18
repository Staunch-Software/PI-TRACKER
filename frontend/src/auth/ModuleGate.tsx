import { Navigate, Outlet } from 'react-router-dom';
import { useRole } from './useRole';

interface Props {
  module: 'pi' | 'pir';
}

// Route-level guard for the PI vs PIR module flags — defense in depth alongside the backend's
// require_module_access (that 403s the API calls either way), so a user without access doesn't
// even see a broken/empty page if they type the URL directly rather than clicking a hidden nav
// link. Redirects to whichever module they DO have access to; if neither, falls through to a
// plain message rather than looping between two denied routes.
export function ModuleGate({ module }: Props) {
  const { canAccessPi, canAccessPir } = useRole();
  const hasAccess = module === 'pi' ? canAccessPi : canAccessPir;

  if (hasAccess) return <Outlet />;
  if (module === 'pi' && canAccessPir) return <Navigate to="/pir" replace />;
  if (module === 'pir' && canAccessPi) return <Navigate to="/dashboard" replace />;

  return (
    <div style={{ padding: '2rem', color: 'var(--color-text-muted)' }}>
      You don't have access to this module. Contact your administrator.
    </div>
  );
}
