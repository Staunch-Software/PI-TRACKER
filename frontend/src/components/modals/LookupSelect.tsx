import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

interface LookupItem {
  id: string;
  name: string;
}

interface Props {
  label: string;
  items: LookupItem[];
  value: string;
  onChange: (id: string) => void;
  createPath: '/vessels' | '/vendors';
  queryKey: string;
  compact?: boolean; // no <label>/wrapper — for embedding inline (e.g. a table cell)
}

export function LookupSelect({ label, items, value, onChange, createPath, queryKey, compact = false }: Props) {
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (name: string) => api.post<LookupItem>(createPath, { name }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      onChange(created.id);
      setIsAdding(false);
      setNewName('');
    },
  });

  const body = isAdding ? (
    <div style={{ display: 'flex', gap: 6 }}>
      <input
        autoFocus
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        placeholder={`New ${label.toLowerCase()} name`}
      />
      <button
        type="button"
        className="btn btn-secondary"
        disabled={!newName.trim() || createMutation.isPending}
        onClick={() => createMutation.mutate(newName.trim())}
      >
        Save
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => setIsAdding(false)}>
        Cancel
      </button>
    </div>
  ) : (
    <div style={{ display: 'flex', gap: 6 }}>
      <select value={value} onChange={(e) => onChange(e.target.value)} required style={{ flex: 1 }}>
        <option value="" disabled>
          Select {label.toLowerCase()}…
        </option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <button type="button" className="btn btn-secondary" onClick={() => setIsAdding(true)}>
        + New
      </button>
    </div>
  );

  if (compact) return body;

  return (
    <div className="field">
      <label>{label}</label>
      {body}
    </div>
  );
}
