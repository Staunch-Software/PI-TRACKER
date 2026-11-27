// Display-only names for the internal 'TSI'/'TA' rank/role values (kept as-is everywhere else —
// the DB column, API query params, and every internal comparison/key still use 'TSI'/'TA', per
// the user's explicit choice not to touch those). This maps the short internal code to what a
// person actually sees on screen or in a generated report/email.
export const ROLE_LABELS: Record<'TSI' | 'TA', string> = {
  TSI: 'Vessel Manager',
  TA: 'Purchaser',
};

export function roleLabel(role: 'TSI' | 'TA' | string): string {
  return ROLE_LABELS[role as 'TSI' | 'TA'] ?? role;
}
