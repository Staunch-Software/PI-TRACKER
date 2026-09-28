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

  const addForm = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#111424' }}>Add New {label}</div>
      <input
        autoFocus
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        placeholder={`New ${label.toLowerCase()} name`}
        style={{ border: '1px solid var(--color-primary)', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none' }}
        onFocus={(e) => (e.target.style.boxShadow = '0 0 0 3px rgba(var(--color-primary-rgb), 0.15)')}
        onBlur={(e) => (e.target.style.boxShadow = 'none')}
      />
      {isVessel && (
        <input
          value={newImoNumber}
          onChange={(e) => setNewImoNumber(e.target.value)}
          placeholder="IMO number"
          style={{ border: '1px solid var(--color-primary)', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none' }}
          onFocus={(e) => (e.target.style.boxShadow = '0 0 0 3px rgba(var(--color-primary-rgb), 0.15)')}
          onBlur={(e) => (e.target.style.boxShadow = 'none')}
        />
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button
          type="button"
          className="btn-tracker-action btn-tracker-secondary"
          onClick={(e) => {
            e.stopPropagation();
            setIsAdding(false);
          }}
          style={{ padding: '6px 12px', height: 'auto', fontSize: 13 }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn-tracker-action btn-tracker-primary"
          disabled={!canSave}
          onClick={(e) => {
            e.stopPropagation();
            createMutation.mutate(newName.trim());
          }}
          style={{ padding: '6px 12px', height: 'auto', fontSize: 13 }}
        >
          {createMutation.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );

  const body = (
    <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 0 }}>
      <SearchableSelect
        options={items.map((item) => ({ value: item.id, label: item.name }))}
        value={value}
        onChange={onChange}
        placeholder={`Select ${label.toLowerCase()}…`}
        onAddNew={() => setIsAdding(true)}
        addNewLabel={`+ Add New ${label}`}
        customPanelContent={isAdding ? addForm : undefined}
        onClose={() => setIsAdding(false)}
      />
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
