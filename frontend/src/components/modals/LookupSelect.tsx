import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { SearchableSelect } from '../common/SearchableSelect';

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
  const isVessel = createPath === '/vessels';
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newImoNumber, setNewImoNumber] = useState('');
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      api.post<LookupItem>(createPath, isVessel ? { name, imoNumber: newImoNumber.trim() } : { name }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      onChange(created.id);
      setIsAdding(false);
      setNewName('');
      setNewImoNumber('');
    },
  });

  const canSave = newName.trim() && (!isVessel || newImoNumber.trim()) && !createMutation.isPending;

  const body = isAdding ? (
    <div style={{ display: 'flex', gap: 6 }}>
      <input
        autoFocus
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        placeholder={`New ${label.toLowerCase()} name`}
      />
      {isVessel && (
        <input
          value={newImoNumber}
          onChange={(e) => setNewImoNumber(e.target.value)}
          placeholder="IMO number"
          style={{ width: 120 }}
        />
      )}
      <button
        type="button"
        className="btn btn-secondary"
        disabled={!canSave}
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <SearchableSelect
          options={items.map((item) => ({ value: item.id, label: item.name }))}
          value={value}
          onChange={onChange}
          placeholder={`Select ${label.toLowerCase()}…`}
        />
      </div>
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
