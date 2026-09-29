import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { DEPARTMENT_LABELS, Department, type VendorMapping } from '../../shared';

interface DropdownOption {
  value: string;
  label: string;
}

function DepartmentDropdown({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pos, setPos] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? options[0];

  function updatePosition() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - 12;
    const spaceAbove = r.top - 12;
    // Prefer opening downward (like a native select); only flip up when there is almost no room below.
    const openUp = spaceBelow < 100 && spaceAbove > spaceBelow;
    setPos({
      left: r.left,
      width: r.width,
      maxHeight: Math.min(280, openUp ? spaceAbove : spaceBelow),
      ...(openUp ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }

  function openPanel() {
    const idx = options.findIndex((o) => o.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);
    setOpen(true);
  }

  function choose(v: string) {
    onChange(v);
    setOpen(false);
    triggerRef.current?.focus();
  }

  useLayoutEffect(() => {
    if (open) updatePosition();
    else setPos(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  // Bring the selected/active row into view whenever the panel opens or the active row changes.
  useEffect(() => {
    if (!open || !pos) return;
    panelRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, pos !== null]);

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openPanel();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(options[activeIndex].value);
    }
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`mailbox-dropdown-trigger${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPanel())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="mailbox-dropdown-value">{selected?.label}</span>
        <svg className="mailbox-dropdown-caret" width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="mailbox-dropdown-panel"
            role="listbox"
            style={{
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              top: pos.top,
              bottom: pos.bottom,
            }}
          >
            {options.map((o, i) => (
              <div
                key={o.value || 'none'}
                role="option"
                aria-selected={o.value === value}
                data-active={i === activeIndex}
                className={`mailbox-dropdown-option${o.value === value ? ' selected' : ''}${i === activeIndex ? ' active' : ''}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => choose(o.value)}
              >
                {o.label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

interface Props {
  mapping: VendorMapping | null; // null = create mode
  onClose: () => void;
}

export function VendorMappingModal({ mapping, onClose }: Props) {
  const isEdit = mapping !== null;
  const [vendorName, setVendorName] = useState(mapping?.vendorName ?? '');
  const [department, setDepartment] = useState<Department>(mapping?.department ?? Department.TECHNICAL);
  const [active, setActive] = useState(mapping?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () =>
      isEdit
        ? api.patch<VendorMapping>(`/vendor-mapping/${mapping.id}`, { vendorName, department, active })
        : api.post<VendorMapping>('/vendor-mapping', { vendorName, department }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-vendor-mapping'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to save vendor mapping.'),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    saveMutation.mutate();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel user-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? `Edit Vendor Mapping — ${mapping.vendorName}` : 'Add New Vendor Mapping'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="field">
              <label>Vendor Name</label>
              <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} required autoFocus />
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label>Department</label>
              <DepartmentDropdown
                value={department}
                onChange={(v) => setDepartment(v as Department)}
                options={Object.values(Department).map((d) => ({ value: d, label: DEPARTMENT_LABELS[d] }))}
              />
            </div>
            {isEdit && (
              <div className="field" style={{ marginTop: 14 }}>
                <label>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                    style={{ marginRight: 6 }}
                  />
                  Active
                </label>
              </div>
            )}
            {error && <p className="form-error" style={{ marginTop: 14 }}>{error}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Vendor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}