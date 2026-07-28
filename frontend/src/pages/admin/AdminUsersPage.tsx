import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../lib/api';
import type { User } from '../../shared';
import { UserModal } from '../../components/modals/UserModal';
import { formatDate } from '../../lib/format';

export function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalUser, setModalUser] = useState<User | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const queryClient = useQueryClient();

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') });

  const deactivateMutation = useMutation({
    mutationFn: (user: User) => api.patch<User>(`/users/${user.id}`, { isActive: !user.isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
    },
  });

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setIsAdding(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function handleDelete(user: User) {
    const verb = user.isActive ? 'Deactivate' : 'Reactivate';
    if (window.confirm(`${verb} ${user.fullName}?`)) {
      deactivateMutation.mutate(user);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>User Management</h1>
          <p>{usersQuery.data ? `${usersQuery.data.length} users` : 'Loading…'}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setIsAdding(true)}>
          + Add New User
        </button>
      </div>

      <div className="card table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Full Name</th>
              <th>Email</th>
              <th>Role</th>
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
                <td>{u.fullName}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>
                  <span
                    className="status-badge"
                    style={
                      u.isActive
                        ? { background: 'var(--color-success-bg)', color: 'var(--color-success)' }
                        : { background: 'var(--color-neutral-bg)', color: 'var(--color-neutral)' }
                    }
                  >
                    {u.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>{formatDate(u.createdAt)}</td>
                <td style={{ textAlign: 'center' }}>
                  <div className="row-actions">
                    <button className="icon-btn" title="Edit" onClick={() => setModalUser(u)}>
                      ✎
                    </button>
                    <button
                      className="icon-btn"
                      title={isSelf ? "You can't deactivate your own account" : u.isActive ? 'Deactivate' : 'Reactivate'}
                      onClick={() => handleDelete(u)}
                      disabled={deactivateMutation.isPending || isSelf}
                    >
                      {u.isActive ? '🗑' : '↺'}
                    </button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(isAdding || modalUser) && (
        <UserModal
          user={modalUser}
          onClose={() => {
            setIsAdding(false);
            setModalUser(null);
          }}
        />
      )}
    </div>
  );
}
