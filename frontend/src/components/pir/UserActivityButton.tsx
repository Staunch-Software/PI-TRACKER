import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { canAccessUserActivity } from '../../auth/userActivityAccess';
import { UserActivityModal } from './UserActivityModal';

export function UserActivityButton() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  if (!canAccessUserActivity(user?.email)) return null;

  return (
    <>
      <button type="button" className="user-activity-header-trigger" onClick={() => setOpen(true)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18" />
          <path d="m19 9-5 5-4-4-3 3" />
        </svg>
        User Activity
      </button>
      {open && <UserActivityModal onClose={() => setOpen(false)} />}
    </>
  );
}
