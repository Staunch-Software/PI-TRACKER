import { useRole } from './useRole';

// Single source of truth for "which module should a user land on" — same pi -> pir -> soa ->
// landing priority order ModuleGate already uses to redirect AWAY from a module the user lacks
// access to. Shared here so the "/" root route can pick the right module directly instead of
// always bouncing through /dashboard first and letting ModuleGate redirect a second time.
export function useFirstAvailableModulePath(): string | null {
  const { canAccessPi, canAccessPir, canAccessSoa, canAccessLanding } = useRole();
  if (canAccessPi) return '/dashboard';
  if (canAccessPir) return '/pir';
  if (canAccessSoa) return '/soa';
  if (canAccessLanding) return '/landing-reports';
  return null;
}
