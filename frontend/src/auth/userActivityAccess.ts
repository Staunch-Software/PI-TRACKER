// Mirrors backend/app/api/deps.py USER_ACTIVITY_ALLOWED_EMAILS — a hardcoded allowlist, not a
// role/module flag, since the "User Activity" feature surfaces per-person productivity data and
// is deliberately restricted to these two people regardless of their app role. Keep both lists in
// sync by hand (same "no codegen between enums" convention as shared/enums.ts).
const USER_ACTIVITY_ALLOWED_EMAILS = ['techdevops@ozellar.com', 'karunya.pius@ozellar.com'];

export function canAccessUserActivity(email: string | null | undefined): boolean {
  return !!email && USER_ACTIVITY_ALLOWED_EMAILS.includes(email.toLowerCase());
}
