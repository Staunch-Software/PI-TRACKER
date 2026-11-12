import type { User } from './types';

// Single source of truth for "which per-user module-access flags exist, and what to call them" —
// added 2026-11-04 after AdminUsersPage.tsx's Module Access badge silently fell out of sync with
// the actual set of modules (it had its own separate, hand-maintained array that was never
// updated when DD Tracker/Vendor Management were added, while UserModal.tsx's checkboxes were).
// Anything that lists/renders module access should read from this array instead of maintaining
// its own copy, so a future 7th module only has to be added here once.
export interface ModuleAccessField {
  key: keyof Pick<
    User,
    | 'canAccessPi'
    | 'canAccessPir'
    | 'canAccessSoa'
    | 'canAccessLanding'
    | 'canAccessDd'
    | 'canAccessVendor'
    | 'canAccessPd'
  >;
  label: string;
}

export const MODULE_ACCESS_FIELDS: ModuleAccessField[] = [
  { key: 'canAccessPi', label: 'PI' },
  { key: 'canAccessPir', label: 'PIR' },
  { key: 'canAccessSoa', label: 'SOA' },
  { key: 'canAccessLanding', label: 'Landing Reports' },
  { key: 'canAccessDd', label: 'DD Tracker' },
  { key: 'canAccessVendor', label: 'Vendor Management' },
  { key: 'canAccessPd', label: 'PD Tracker' },
];
