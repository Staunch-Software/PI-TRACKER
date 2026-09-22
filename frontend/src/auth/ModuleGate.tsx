import { Navigate, Outlet } from 'react-router-dom';
import { useRole } from './useRole';

interface Props {
  module: 'pi' | 'pir' | 'soa';
}

// Route-level guard for the module-access flags — defense in depth alongside the backend's
// require_module_access (that 403s the API calls either way), so a user without access doesn't
// even see a broken/empty page if they type the URL directly rather than clicking a hidden nav
// link. Redirects to whichever module they DO have access to; if none, falls through to a plain
// message rather than looping between denied routes.
export function ModuleGate({ module }: Props) {
  const { canAccessPi, canAccessPir, canAccessSoa } = useRole();
  const hasAccess = module === 'pi' ? canAccessPi : module === 'pir' ? canAccessPir : canAccessSoa;

  if (hasAccess) return <Outlet />;
  if (module !== 'pi' && canAccessPi) return <Navigate to="/dashboard" replace />;
  if (module !== 'pir' && canAccessPir) return <Navigate to="/pir" replace />;
  if (module !== 'soa' && canAccessSoa) return <Navigate to="/soa" replace />;

  return (
    <div style={{ padding: '2rem', color: 'var(--color-text-muted)' }}>
      You don't have access to this module. Contact your administrator.
    </div>
  );
}
