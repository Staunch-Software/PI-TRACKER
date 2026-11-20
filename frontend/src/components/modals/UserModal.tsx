import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { UserRole, type User } from '../../shared';
import { ModernDropdown, type ModernDropdownOption } from '../common/ModernDropdown';

interface Props {
  user: User | null; // null = create mode
  onClose: () => void;
}

type ModuleKey =
  | 'canAccessPi'
  | 'canAccessPir'
  | 'canAccessSoa'
  | 'canAccessLanding'
  | 'canAccessDd'
  | 'canAccessVendor'
  | 'canAccessPd'
  | 'canAccessPendingItems';

interface ModuleItem {
  key: ModuleKey;
  name: string;
  desc: string;
  badge?: string;
}

const MODULES_CONFIG: ModuleItem[] = [
  { key: 'canAccessPi', name: 'PI Follow-up', desc: 'Proforma invoices & vessel queries' },
  { key: 'canAccessPir', name: 'PIR Tracker', desc: 'Purchase invoice registers' },
  { key: 'canAccessSoa', name: 'SOA Ingestion', desc: 'Supplier statement reconciliation' },
  { key: 'canAccessLanding', name: 'Landing Reports', desc: 'Vessel landing & delivery logs' },
  { key: 'canAccessDd', name: 'DD Tracker', desc: 'Dry docking orders & expenses' },
  { key: 'canAccessVendor', name: 'Vendor Mgmt', desc: 'Approved vendors & suppliers' },
  { key: 'canAccessPd', name: 'PD Tracker', desc: 'Port disbursements & voyage costs' },
  { key: 'canAccessPendingItems', name: 'TSI/TA Pending', desc: 'Ageing matrix & pending follow-up', badge: 'MAIL READY' },
];

const ROLE_OPTIONS: ModernDropdownOption[] = [
  {
    value: UserRole.VIEWER,
    label: 'Viewer',
    sublabel: 'Read-only access across enabled modules',
    badge: (
      <span className="role-pill viewer">
        <span className="role-pill-dot" />
        Viewer
      </span>
    ),
  },
  {
    value: UserRole.EDITOR,
    label: 'Editor',
    sublabel: 'Can create and modify records in permitted modules',
    badge: (
      <span className="role-pill editor">
        <span className="role-pill-dot" />
        Editor
      </span>
    ),
  },
  {
    value: UserRole.ADMIN,
    label: 'Administrator',
    sublabel: 'Full system management and unrestricted access',
    badge: (
      <span className="role-pill admin">
        <span className="role-pill-dot" />
        Admin
      </span>
    ),
  },
];

const RANK_OPTIONS: ModernDropdownOption[] = [
  {
    value: '',
    label: 'None (Unassigned)',
    sublabel: 'Not assigned to TSI or TA pending rosters',
  },
  {
    value: 'TSI',
    label: 'TSI — Technical Superintendent',
    sublabel: 'Assigned to TSI Pending roster and email dispatches',
    badge: <span className="badge-rank-tsi">TSI</span>,
  },
  {
    value: 'TA',
    label: 'TA — Technical Assistant',
    sublabel: 'Assigned to TA Pending roster and email dispatches',
    badge: <span className="badge-rank-ta">TA</span>,
  },
];

/* ── Clean SVG Icons (Zero Emojis) ── */
function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

function AlertCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

const TSI_KEYWORDS = ['abhinav', 'abhishek', 'abhisek', 'gaurav', 'murtuza', 'pavan'];
const TA_KEYWORDS = ['sunil', 'sunilkumar', 'bharat', 'bharath', 'gayathri', 'jayasri', 'viswa', 'viswanathan'];

function inferRank(text: string): string {
  const lower = text.toLowerCase();
  for (const kw of TSI_KEYWORDS) {
    if (lower.includes(kw)) return 'TSI';
  }
  for (const kw of TA_KEYWORDS) {
    if (lower.includes(kw)) return 'TA';
  }
  return '';
}

export function UserModal({ user, onClose }: Props) {
  const isEdit = user !== null;
  const [email, setEmail] = useState(user?.email ?? '');
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [role, setRole] = useState<UserRole>(user?.role ?? UserRole.VIEWER);
  const [rank, setRank] = useState<string>(user?.rank ?? '');
  const [hasManuallySetRank, setHasManuallySetRank] = useState(isEdit && Boolean(user?.rank));
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [canAccessPi, setCanAccessPi] = useState(user?.canAccessPi ?? true);
  const [canAccessPir, setCanAccessPir] = useState(user?.canAccessPir ?? true);
  const [canAccessSoa, setCanAccessSoa] = useState(user?.canAccessSoa ?? true);
  const [canAccessLanding, setCanAccessLanding] = useState(user?.canAccessLanding ?? true);
  const [canAccessDd, setCanAccessDd] = useState(user?.canAccessDd ?? true);
  const [canAccessVendor, setCanAccessVendor] = useState(user?.canAccessVendor ?? true);
  const [canAccessPd, setCanAccessPd] = useState(user?.canAccessPd ?? true);
  const [canAccessPendingItems, setCanAccessPendingItems] = useState(user?.canAccessPendingItems ?? true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const moduleStateMap: Record<ModuleKey, { value: boolean; set: (val: boolean) => void }> = {
    canAccessPi: { value: canAccessPi, set: setCanAccessPi },
    canAccessPir: { value: canAccessPir, set: setCanAccessPir },
    canAccessSoa: { value: canAccessSoa, set: setCanAccessSoa },
    canAccessLanding: { value: canAccessLanding, set: setCanAccessLanding },
    canAccessDd: { value: canAccessDd, set: setCanAccessDd },
    canAccessVendor: { value: canAccessVendor, set: setCanAccessVendor },
    canAccessPd: { value: canAccessPd, set: setCanAccessPd },
    canAccessPendingItems: { value: canAccessPendingItems, set: setCanAccessPendingItems },
  };

  const isAdmin = role === UserRole.ADMIN;

  const enabledCount = isAdmin
    ? MODULES_CONFIG.length
    : MODULES_CONFIG.filter((m) => moduleStateMap[m.key].value).length;

  const saveMutation = useMutation({
    mutationFn: () =>
      isEdit
        ? api.patch<User>(`/users/${user.id}`, {
            fullName,
            role,
            rank: rank || null,
            isActive,
            canAccessPi,
            canAccessPir,
            canAccessSoa,
            canAccessLanding,
            canAccessDd,
            canAccessVendor,
            canAccessPd,
            canAccessPendingItems,
            ...(password ? { password } : {}),
          })
        : api.post<User>('/users', {
            email,
            fullName,
            role,
            rank: rank || null,
            password,
            canAccessPi,
            canAccessPir,
            canAccessSoa,
            canAccessLanding,
            canAccessDd,
            canAccessVendor,
            canAccessPd,
            canAccessPendingItems,
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to save user.'),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    saveMutation.mutate();
  }

  function handleSelectAllModules() {
    setCanAccessPi(true);
    setCanAccessPir(true);
    setCanAccessSoa(true);
    setCanAccessLanding(true);
    setCanAccessDd(true);
    setCanAccessVendor(true);
    setCanAccessPd(true);
    setCanAccessPendingItems(true);
  }

  function handleClearAllModules() {
    setCanAccessPi(false);
    setCanAccessPir(false);
    setCanAccessSoa(false);
    setCanAccessLanding(false);
    setCanAccessDd(false);
    setCanAccessVendor(false);
    setCanAccessPd(false);
    setCanAccessPendingItems(false);
  }

  function handleToggleModule(key: ModuleKey) {
    if (isAdmin) return;
    const item = moduleStateMap[key];
    item.set(!item.value);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel admin-user-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="user-modal-header-text">
            <h2>{isEdit ? `Edit User — ${user.fullName}` : 'Add New User'}</h2>
            <p className="user-modal-header-desc">
              {isEdit ? `Account: ${user.email}` : 'Configure credentials, system role, rank, and module permissions.'}
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close modal">
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="user-modal-form-shell">
              {/* Card 1: Account Credentials */}
              <div className="user-modal-card">
                <div className="user-modal-card-header">
                  <div className="user-modal-card-title-wrap">
                    <span className="user-modal-card-title-icon"><UserIcon /></span>
                    <h3 className="user-modal-card-title">Account Credentials</h3>
                  </div>
                </div>

                <div className="user-modal-grid-2col">
                  <div className="user-modal-field">
                    <label>Email Address</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEmail(val);
                        if (!isEdit && !hasManuallySetRank) {
                          const auto = inferRank(`${val} ${fullName}`);
                          if (auto) setRank(auto);
                        }
                      }}
                      disabled={isEdit}
                      placeholder="user@ozellar.com"
                      required
                    />
                    {isEdit && (
                      <span className="user-modal-field-hint">Email address cannot be changed once created.</span>
                    )}
                  </div>

                  <div className="user-modal-field">
                    <label>Full Name</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFullName(val);
                        if (!isEdit && !hasManuallySetRank) {
                          const auto = inferRank(`${email} ${val}`);
                          if (auto) setRank(auto);
                        }
                      }}
                      placeholder="e.g. John Doe"
                      required
                    />
                  </div>
                </div>

                <div style={{ marginTop: 14 }}>
                  <div className="user-modal-field">
                    <label>{isEdit ? 'New Password (leave blank to keep current)' : 'Password'}</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required={!isEdit}
                      placeholder={isEdit ? '••••••••' : 'Enter initial password'}
                      autoComplete="new-password"
                    />
                  </div>
                </div>
              </div>

              {/* Card 2: Role & Designation */}
              <div className="user-modal-card">
                <div className="user-modal-card-header">
                  <div className="user-modal-card-title-wrap">
                    <span className="user-modal-card-title-icon"><ShieldIcon /></span>
                    <h3 className="user-modal-card-title">Role &amp; Roster Assignment</h3>
                  </div>
                </div>

                <div className="user-modal-grid-2col">
                  <div className="user-modal-field">
                    <label>System Role</label>
                    <ModernDropdown
                      options={ROLE_OPTIONS}
                      value={role}
                      onChange={(val) => setRole(val as UserRole)}
                      ariaLabel="Select system role"
                    />
                  </div>

                  <div className="user-modal-field">
                    <label>Rank (Pending Items Roster)</label>
                    <ModernDropdown
                      options={RANK_OPTIONS}
                      value={rank}
                      onChange={(val) => {
                        setRank(val);
                        setHasManuallySetRank(true);
                      }}
                      ariaLabel="Select rank assignment"
                    />
                  </div>
                </div>

                {isEdit && (
                  <div style={{ marginTop: 14 }}>
                    <div
                      className={`user-active-toggle-card ${isActive ? 'active' : 'inactive'}`}
                      onClick={() => setIsActive(!isActive)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          e.preventDefault();
                          setIsActive(!isActive);
                        }
                      }}
                    >
                      <div className="user-active-toggle-left">
                        <span className="user-active-toggle-title">
                          Account Login Status: {isActive ? 'Active' : 'Suspended'}
                        </span>
                        <span className="user-active-toggle-desc">
                          {isActive
                            ? 'User can authenticate and access authorized application modules.'
                            : 'User login is blocked. The user cannot sign in.'}
                        </span>
                      </div>
                      <span className={`user-status-pill ${isActive ? 'active' : 'inactive'}`}>
                        {isActive ? 'Active' : 'Deactivated'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Card 3: Module Permissions */}
              <div className="user-modal-card">
                <div className="user-modal-card-header">
                  <div className="user-modal-card-title-wrap">
                    <span className="user-modal-card-title-icon"><GridIcon /></span>
                    <h3 className="user-modal-card-title">
                      Module Access ({enabledCount} of {MODULES_CONFIG.length} enabled)
                    </h3>
                  </div>

                  {!isAdmin && (
                    <div className="user-permission-actions">
                      <button
                        type="button"
                        className="user-permission-btn-action"
                        onClick={handleSelectAllModules}
                      >
                        Select All
                      </button>
                      <span style={{ color: '#CBD5E1' }}>•</span>
                      <button
                        type="button"
                        className="user-permission-btn-action clear"
                        onClick={handleClearAllModules}
                      >
                        Clear All
                      </button>
                    </div>
                  )}
                </div>

                <div className="user-permission-grid">
                  {MODULES_CONFIG.map((mod) => {
                    const isModuleActive = isAdmin || moduleStateMap[mod.key].value;
                    return (
                      <div
                        key={mod.key}
                        className={`user-permission-card ${isModuleActive ? 'active' : ''} ${isAdmin ? 'admin-override' : ''}`}
                        onClick={() => handleToggleModule(mod.key)}
                        role="checkbox"
                        aria-checked={isModuleActive}
                        tabIndex={isAdmin ? -1 : 0}
                        onKeyDown={(e) => {
                          if (e.key === ' ' || e.key === 'Enter') {
                            e.preventDefault();
                            handleToggleModule(mod.key);
                          }
                        }}
                      >
                        <div className="user-permission-card-top">
                          <span>{mod.name}</span>
                          <div className="user-permission-check-box">
                            {isModuleActive && <CheckIcon />}
                          </div>
                        </div>
                        {mod.badge && <span className="user-permission-badge">{mod.badge}</span>}
                        <span className="user-permission-card-desc">{mod.desc}</span>
                      </div>
                    );
                  })}
                </div>

                {isAdmin && (
                  <div className="user-permission-admin-notice">
                    <ShieldIcon />
                    <span>Administrators automatically possess full, unrestricted access across all system modules.</span>
                  </div>
                )}
              </div>
            </div>

            {error && (
              <div className="admin-delete-modal-error" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertCircleIcon />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saveMutation.isPending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
