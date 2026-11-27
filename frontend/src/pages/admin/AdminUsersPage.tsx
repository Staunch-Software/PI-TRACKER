import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { api, ApiError } from '../../lib/api';
import { MODULE_ACCESS_FIELDS, UserRole, roleLabel, type User } from '../../shared';
import { UserModal } from '../../components/modals/UserModal';
import { formatDate } from '../../lib/format';
import { TrashIcon } from '../../components/common/TrashIcon';
import { EditIcon } from '../../components/common/EditIcon';
import { SearchIcon } from '../../components/common/SearchIcon';
import { ModernDropdown, type ModernDropdownOption } from '../../components/common/ModernDropdown';

import './AdminUsersPage.css';

/* ── Clean SVG Icons (Zero Emojis) ── */
function UsersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AnchorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="3" />
      <line x1="12" y1="22" x2="12" y2="8" />
      <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
    </svg>
  );
}

function ZapIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function AlertTriangleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function StatusToggleIcon({ active }: { active: boolean }) {
  return active ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (name.slice(0, 2) || '--').toUpperCase();
}

function getAvatarClass(u: User): string {
  if (u.role === UserRole.ADMIN) return 'admin';
  if (u.rank === 'TSI') return 'tsi';
  if (u.rank === 'TA') return 'ta';
  if (u.role === UserRole.EDITOR) return 'editor';
  return 'viewer';
}

const ROLE_OPTIONS: ModernDropdownOption[] = [
  { value: 'ALL', label: 'All Roles' },
  { value: UserRole.ADMIN, label: 'Admin', sublabel: 'Full administrator override', badge: <span className="role-pill admin"><span className="role-pill-dot" />Admin</span> },
  { value: UserRole.EDITOR, label: 'Editor', sublabel: 'Operational edit & create access', badge: <span className="role-pill editor"><span className="role-pill-dot" />Editor</span> },
  { value: UserRole.VIEWER, label: 'Viewer', sublabel: 'Read-only observation access', badge: <span className="role-pill viewer"><span className="role-pill-dot" />Viewer</span> },
];

const RANK_OPTIONS: ModernDropdownOption[] = [
  { value: 'ALL', label: `All Ranks (${roleLabel('TSI')} / ${roleLabel('TA')})` },
  { value: 'TSI', label: roleLabel('TSI'), badge: <span className="badge-rank-tsi">{roleLabel('TSI')}</span> },
  { value: 'TA', label: roleLabel('TA'), badge: <span className="badge-rank-ta">{roleLabel('TA')}</span> },
  { value: 'NONE', label: 'General Staff (No Rank)' },
];

const STATUS_OPTIONS: ModernDropdownOption[] = [
  { value: 'ALL', label: 'All Status' },
  { value: 'ACTIVE', label: 'Active Accounts Only' },
  { value: 'INACTIVE', label: 'Inactive / Suspended' },
];

export function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [modalUser, setModalUser] = useState<User | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [statusConfirmUser, setStatusConfirmUser] = useState<User | null>(null);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Filters state
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [rankFilter, setRankFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const queryClient = useQueryClient();

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<User[]>('/users'),
  });

  const allUsers = usersQuery.data ?? [];

  // Statistics
  const stats = useMemo(() => {
    return {
      total: allUsers.length,
      active: allUsers.filter((u) => u.isActive).length,
      tsi: allUsers.filter((u) => u.rank === 'TSI').length,
      ta: allUsers.filter((u) => u.rank === 'TA').length,
      admin: allUsers.filter((u) => u.role === UserRole.ADMIN).length,
    };
  }, [allUsers]);

  // Filtered users list
  const filteredUsers = useMemo(() => {
    return allUsers.filter((u) => {
      // Search by name or email
      if (search) {
        const q = search.toLowerCase().trim();
        const matchesName = u.fullName.toLowerCase().includes(q);
        const matchesEmail = u.email.toLowerCase().includes(q);
        if (!matchesName && !matchesEmail) return false;
      }
      // Role filter
      if (roleFilter !== 'ALL' && u.role !== roleFilter) {
        return false;
      }
      // Rank filter
      if (rankFilter !== 'ALL') {
        if (rankFilter === 'NONE' && u.rank) return false;
        if (rankFilter !== 'NONE' && u.rank !== rankFilter) return false;
      }
      // Status filter
      if (statusFilter === 'ACTIVE' && !u.isActive) return false;
      if (statusFilter === 'INACTIVE' && u.isActive) return false;

      return true;
    });
  }, [allUsers, search, roleFilter, rankFilter, statusFilter]);

  const hasActiveFilters = search !== '' || roleFilter !== 'ALL' || rankFilter !== 'ALL' || statusFilter !== 'ALL';

  function resetFilters() {
    setSearch('');
    setRoleFilter('ALL');
    setRankFilter('ALL');
    setStatusFilter('ALL');
  }

  // Deactivate / Reactivate Mutation
  const deactivateMutation = useMutation({
    mutationFn: (user: User) => api.patch<User>(`/users/${user.id}`, { isActive: !user.isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
    },
    onSettled: () => setStatusConfirmUser(null),
  });

  // Hard Delete Mutation
  const deleteMutation = useMutation({
    mutationFn: (user: User) => api.delete<{ deleted: boolean }>(`/users/${user.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
      setUserToDelete(null);
      setDeleteError(null);
    },
    onError: (err) => {
      setDeleteError(err instanceof ApiError ? err.message : 'Failed to delete user.');
    },
  });

  function handleDeleteClick(user: User) {
    setDeleteError(null);
    setUserToDelete(user);
  }

  return (
    <>
      {/* Header */}
      <div className="admin-page-header">
        <div>
          <div className="admin-title-row">
            <h1 className="admin-page-title">User Management</h1>
            <div className="admin-page-count">
              <span className="count-number">{filteredUsers.length}</span>
              <span className="count-label">{hasActiveFilters ? 'Filtered Users' : 'Total Users'}</span>
            </div>
          </div>
          <p className="admin-page-subtitle">
            Manage system access, roles, module permissions, and pending items assignments.
          </p>
        </div>
        <button className="admin-btn-primary" onClick={() => setIsAdding(true)}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Add New User
        </button>
      </div>

      <div className="admin-page-body">
        {/* Quick Stats Strip (No Emojis) */}
        <div className="user-stats-strip">
          <div className="user-stat-card">
            <div className="user-stat-icon-wrap" style={{ background: '#EFF6FF', color: '#2563EB' }}>
              <UsersIcon />
            </div>
            <div>
              <div className="user-stat-val">{stats.total}</div>
              <div className="user-stat-lbl">Registered</div>
            </div>
          </div>

          <div className="user-stat-card">
            <div className="user-stat-icon-wrap" style={{ background: '#DCFCE7', color: '#16A34A' }}>
              <CheckCircleIcon />
            </div>
            <div>
              <div className="user-stat-val" style={{ color: '#16A34A' }}>{stats.active}</div>
              <div className="user-stat-lbl">Active Accounts</div>
            </div>
          </div>

          <div className="user-stat-card">
            <div className="user-stat-icon-wrap" style={{ background: '#EFF6FF', color: '#1E40AF' }}>
              <AnchorIcon />
            </div>
            <div>
              <div className="user-stat-val" style={{ color: '#1E40AF' }}>{stats.tsi}</div>
              <div className="user-stat-lbl">{roleLabel('TSI')} Members</div>
            </div>
          </div>

          <div className="user-stat-card">
            <div className="user-stat-icon-wrap" style={{ background: '#FAF5FF', color: '#6D28D9' }}>
              <ZapIcon />
            </div>
            <div>
              <div className="user-stat-val" style={{ color: '#6D28D9' }}>{stats.ta}</div>
              <div className="user-stat-lbl">{roleLabel('TA')} Members</div>
            </div>
          </div>

          <div className="user-stat-card">
            <div className="user-stat-icon-wrap" style={{ background: '#FEF3C7', color: '#D97706' }}>
              <ShieldIcon />
            </div>
            <div>
              <div className="user-stat-val" style={{ color: '#D97706' }}>{stats.admin}</div>
              <div className="user-stat-lbl">Administrators</div>
            </div>
          </div>
        </div>

        {/* Search & Modern Card Dropdown Toolbar */}
        <div className="user-toolbar">
          <div className="user-search-wrap">
            <span className="user-search-icon">
              <SearchIcon />
            </span>
            <input
              type="text"
              className="user-search-input"
              placeholder="Search user by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="user-search-clear"
                onClick={() => setSearch('')}
                title="Clear search"
                aria-label="Clear search"
              >
                <CloseIcon />
              </button>
            )}
          </div>

          <div className="user-filters-group">
            {/* Modern Card Dropdown for Role */}
            <ModernDropdown
              options={ROLE_OPTIONS}
              value={roleFilter}
              onChange={setRoleFilter}
              ariaLabel="Filter by role"
            />

            {/* Modern Card Dropdown for Rank */}
            <ModernDropdown
              options={RANK_OPTIONS}
              value={rankFilter}
              onChange={setRankFilter}
              align="auto"
              ariaLabel="Filter by rank"
            />

            {/* Modern Card Dropdown for Status (anchored right so panel opens inwards without overflowing page width) */}
            <ModernDropdown
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={setStatusFilter}
              align="right"
              ariaLabel="Filter by status"
            />

            {hasActiveFilters && (
              <button
                type="button"
                className="user-reset-filters-btn"
                onClick={resetFilters}
              >
                Reset Filters
              </button>
            )}
          </div>
        </div>

        {/* Users Table Card */}
        <div className="admin-card admin-table-wrapper">
          {filteredUsers.length === 0 ? (
            <div className="user-empty-state">
              <div className="user-empty-state-icon">
                <SearchIcon />
              </div>
              <div className="user-empty-state-title">No matching users found</div>
              <div className="user-empty-state-desc">
                {hasActiveFilters
                  ? 'Try adjusting your search query or filters to find what you are looking for.'
                  : 'No users have been registered yet.'}
              </div>
              {hasActiveFilters && (
                <button
                  type="button"
                  className="admin-btn-secondary"
                  onClick={resetFilters}
                >
                  Clear All Filters
                </button>
              )}
            </div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Rank ({roleLabel('TSI')} / {roleLabel('TA')})</th>
                  <th>Status</th>
                  <th>Module Access</th>
                  <th>Created</th>
                  <th style={{ textAlign: 'center', width: 130 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const isSelf = u.id === currentUser?.id;
                  const initials = getInitials(u.fullName);
                  const avatarClass = getAvatarClass(u);

                  // Calculate module access summary
                  const allowedModules = MODULE_ACCESS_FIELDS.filter((f) => u[f.key]);
                  const isFullAccess = u.role === UserRole.ADMIN || allowedModules.length === MODULE_ACCESS_FIELDS.length;

                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="user-info-cell">
                          <div className={`user-avatar ${avatarClass}`}>{initials}</div>
                          <div>
                            <div className="user-name-title">
                              <span>{u.fullName}</span>
                              {isSelf && <span className="user-self-tag">You</span>}
                            </div>
                            <div className="user-email-subtitle">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {/* Differentiated Role Pill with dedicated color & indicator dot */}
                        <span className={`role-pill ${u.role.toLowerCase()}`}>
                          <span className="role-pill-dot" />
                          {u.role}
                        </span>
                      </td>
                      <td>
                        {u.rank === 'TSI' ? (
                          <span className="badge-rank-tsi">{roleLabel('TSI')}</span>
                        ) : u.rank === 'TA' ? (
                          <span className="badge-rank-ta">{roleLabel('TA')}</span>
                        ) : (
                          <span className="badge-rank-none">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`user-status-pill ${u.isActive ? 'active' : 'inactive'}`}>
                          <span className="user-status-dot" />
                          {u.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        {u.role === UserRole.ADMIN ? (
                          <span className="module-pill full">Full Access (All Modules)</span>
                        ) : isFullAccess ? (
                          <span className="module-pill full">All Modules ({MODULE_ACCESS_FIELDS.length})</span>
                        ) : allowedModules.length > 0 ? (
                          <div className="module-access-pills">
                            {allowedModules.map((m) => (
                              <span key={m.key} className="module-pill">
                                {m.label}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: '#94A3B8', fontSize: 12 }}>No module access</span>
                        )}
                      </td>
                      <td style={{ color: '#64748B', fontSize: 12 }}>{formatDate(u.createdAt)}</td>
                      <td>
                        <div className="user-actions-group" style={{ justifyContent: 'center' }}>
                          {/* Edit Button */}
                          <button
                            type="button"
                            className="btn-user-action edit"
                            title={`Edit ${u.fullName}`}
                            aria-label={`Edit ${u.fullName}`}
                            onClick={() => setModalUser(u)}
                          >
                            <EditIcon />
                          </button>

                          {/* Deactivate / Reactivate Toggle Button */}
                          <button
                            type="button"
                            className="btn-user-action status-toggle"
                            title={
                              isSelf
                                ? "Cannot deactivate own account"
                                : u.isActive
                                  ? `Deactivate ${u.fullName}`
                                  : `Reactivate ${u.fullName}`
                            }
                            aria-label={u.isActive ? `Deactivate ${u.fullName}` : `Reactivate ${u.fullName}`}
                            onClick={() => setStatusConfirmUser(u)}
                            disabled={deactivateMutation.isPending || isSelf}
                          >
                            <StatusToggleIcon active={u.isActive} />
                          </button>

                          {/* Delete Button */}
                          <button
                            type="button"
                            className="btn-user-action delete"
                            title={
                              isSelf
                                ? "Cannot delete own account"
                                : `Delete ${u.fullName}`
                            }
                            aria-label={`Delete ${u.fullName}`}
                            onClick={() => handleDeleteClick(u)}
                            disabled={deleteMutation.isPending || isSelf}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Edit / Add Modal */}
      {(isAdding || modalUser) && (
        <UserModal
          user={modalUser}
          onClose={() => {
            setIsAdding(false);
            setModalUser(null);
          }}
        />
      )}

      {/* Deactivate / Reactivate Confirmation Dialog */}
      {statusConfirmUser && (
        <div
          className="admin-confirm-overlay"
          onClick={() => !deactivateMutation.isPending && setStatusConfirmUser(null)}
        >
          <div
            className="admin-confirm-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`admin-confirm-icon${statusConfirmUser.isActive ? ' danger' : ''}`}>
              <StatusToggleIcon active={statusConfirmUser.isActive} />
            </div>
            <h2 className="admin-confirm-title">
              {statusConfirmUser.isActive ? 'Deactivate User Account' : 'Reactivate User Account'}
            </h2>
            <p className="admin-confirm-text">
              {statusConfirmUser.isActive
                ? `Are you sure you want to deactivate ${statusConfirmUser.fullName}? They will no longer be able to log in to PI Tracker.`
                : `Reactivate ${statusConfirmUser.fullName}? Their login access will be restored immediately.`}
            </p>
            <div className="admin-confirm-actions">
              <button
                type="button"
                className="admin-btn-secondary"
                onClick={() => setStatusConfirmUser(null)}
                disabled={deactivateMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-btn-primary"
                onClick={() => deactivateMutation.mutate(statusConfirmUser)}
                disabled={deactivateMutation.isPending}
              >
                {deactivateMutation.isPending
                  ? 'Updating…'
                  : statusConfirmUser.isActive
                    ? 'Deactivate Account'
                    : 'Reactivate Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Delete Confirmation Dialog */}
      {userToDelete && (
        <div
          className="admin-confirm-overlay"
          onClick={() => !deleteMutation.isPending && setUserToDelete(null)}
        >
          <div
            className="admin-confirm-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-confirm-icon danger">
              <TrashIcon />
            </div>
            <h2 className="admin-confirm-title" style={{ color: '#DC2626' }}>
              Delete User Permanently
            </h2>
            <p className="admin-confirm-text">
              Are you sure you want to permanently delete user{' '}
              <strong>{userToDelete.fullName}</strong> ({userToDelete.email})?
            </p>

            {deleteError ? (
              <div className="admin-delete-modal-error">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                  <AlertTriangleIcon />
                  <span>Deletion Blocked</span>
                </div>
                <div style={{ marginTop: 6 }}>{deleteError}</div>
              </div>
            ) : (
              <div className="admin-delete-modal-warning">
                <strong>Warning:</strong> This permanently removes the user account from the system. If this person created entry history, please deactivate them instead.
              </div>
            )}

            <div className="admin-confirm-actions" style={{ marginTop: 20 }}>
              <button
                type="button"
                className="admin-btn-secondary"
                onClick={() => setUserToDelete(null)}
                disabled={deleteMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-btn-danger"
                onClick={() => deleteMutation.mutate(userToDelete)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
