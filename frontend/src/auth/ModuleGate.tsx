import { Navigate, Outlet } from 'react-router-dom';
import { useFirstAvailableModulePath } from './firstAvailableModulePath';
import { useRole } from './useRole';

interface Props {
  module: 'pi' | 'pir' | 'soa' | 'landing';
}

// Route-level guard for the module-access flags — defense in depth alongside the backend's
// require_module_access (that 403s the API calls either way), so a user without access doesn't
// even see a broken/empty page if they type the URL directly rather than clicking a hidden nav
// link. Redirects to whichever module they DO have access to (see useFirstAvailableModulePath);
// if none, falls through to a plain message rather than looping between denied routes.
export function ModuleGate({ module }: Props) {
  const { canAccessPi, canAccessPir, canAccessSoa, canAccessLanding } = useRole();
  const hasAccess =
    module === 'pi' ? canAccessPi
    : module === 'pir' ? canAccessPir
    : module === 'soa' ? canAccessSoa
    : canAccessLanding;

  const fallbackPath = useFirstAvailableModulePath();

  if (hasAccess) return <Outlet />;
  if (fallbackPath) return <Navigate to={fallbackPath} replace />;

  return (
    <div style={{ padding: '2rem', color: 'var(--color-text-muted)' }}>
      You don't have access to this module. Contact your administrator.
    </div>
  );
}
