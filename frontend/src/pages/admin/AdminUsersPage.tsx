import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../lib/api';
import type { User } from '../../shared';
import { UserModal } from '../../components/modals/UserModal';
import { formatDate } from '../../lib/format';
import { TrashIcon } from '../../components/common/TrashIcon';
import { EditIcon } from '../../components/common/EditIcon';

export function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalUser, setModalUser] = useState<User | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [confirmUser, setConfirmUser] = useState<User | null>(null);
  const queryClient = useQueryClient();

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') });

  const deactivateMutation = useMutation({
    mutationFn: (user: User) => api.patch<User>(`/users/${user.id}`, { isActive: !user.isActive }),
        onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
    },
    onSettled: () => setConfirmUser(null),
  });

    function handleDelete(user: User) {
    setConfirmUser(user);
  }

  return (
    <>
      {/* Header */}
      <div className="admin-page-header">
        <div>
          <div className="admin-title-row">
            <h1 className="admin-page-title">User Management</h1>
            <div className="admin-page-count">
              <span className="count-number">{usersQuery.data ? usersQuery.data.length : 0}</span>
              <span className="count-label">Registered Users</span>
            </div>
          </div>
        </div>
        <button className="admin-btn-primary" onClick={() => setIsAdding(true)}>
          + Add New User
        </button>
      </div>

      <div className="admin-page-body">
        {/* Table */}
        <div className="admin-card admin-table-wrapper">
          <table className="admin-table">
          <thead>
            <tr>
              <th>Full Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Module Access</th>
              <th>Status</th>
              <th>Created</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(usersQuery.data ?? []).map((u) => {
              const isSelf = u.id === currentUser?.id;
              return (
                <tr key={u.id}>
                  <td><strong>{u.fullName}</strong></td>
                  <td style={{ color: '#6B7280' }}>{u.email}</td>
                  <td>
                    <span className="admin-badge role">{u.role}</span>
                  </td>
                  <td>
                    <span className="admin-badge access">
                      {u.role === 'ADMIN'
                        ? 'PI · PIR · SOA · Landing Reports'
                        : [u.canAccessPi && 'PI', u.canAccessPir && 'PIR', u.canAccessSoa && 'SOA', u.canAccessLanding && 'Landing Reports']
                            .filter(Boolean).join(' · ') || '—'}
                    </span>
                  </td>
                  <td>
                    <span className={`admin-badge ${u.isActive ? 'active' : 'inactive'}`}>
                      {u.isActive ? '● Active' : '○ Inactive'}
                    </span>
                  </td>
                  <td style={{ color: '#9CA3AF', fontSize: 12 }}>{formatDate(u.createdAt)}</td>
                  <td>
                    <div className="admin-row-actions">
                      <button className="admin-action-btn" title="Edit" onClick={() => setModalUser(u)}>
                        <EditIcon />
                      </button>
                      <button
                        className={`admin-action-btn${u.isActive ? ' danger' : ''}`}
                        title={isSelf ? "Can't deactivate own account" : u.isActive ? 'Deactivate' : 'Reactivate'}
                        onClick={() => handleDelete(u)}
                        disabled={deactivateMutation.isPending || isSelf}
                      >
                        {u.isActive ? <TrashIcon /> : '↺'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>

            {(isAdding || modalUser) && (
        <UserModal
          user={modalUser}
          onClose={() => { setIsAdding(false); setModalUser(null); }}
        />
      )}

      {confirmUser && (
        <div
          className="admin-confirm-overlay"
          onClick={() => !deactivateMutation.isPending && setConfirmUser(null)}
        >
          <div
            className="admin-confirm-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`admin-confirm-icon${confirmUser.isActive ? ' danger' : ''}`}>
              {confirmUser.isActive ? '!' : '↺'}
            </div>
            <h2 className="admin-confirm-title">
              {confirmUser.isActive ? 'Deactivate User' : 'Reactivate User'}
            </h2>
            <p className="admin-confirm-text">
              Are you sure you want to {confirmUser.isActive ? 'deactivate' : 'reactivate'}{' '}
              <strong>{confirmUser.fullName}</strong>?
            </p>
            <div className="admin-confirm-actions">
              <button
                className="admin-btn-secondary"
                onClick={() => setConfirmUser(null)}
                disabled={deactivateMutation.isPending}
              >
                Cancel
              </button>
              <button
                className="admin-btn-primary"
                onClick={() => deactivateMutation.mutate(confirmUser)}
                disabled={deactivateMutation.isPending}
              >
                {deactivateMutation.isPending ? 'Please wait...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
