import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { FilterIcon } from '../common/FilterIcon';

export type ColumnValueFilterKind = 'text' | 'date' | 'number';

export interface ColumnValueFilterValue {
  text?: string;
  from?: string;
  to?: string;
}

interface Props {
  kind: ColumnValueFilterKind;
  value: ColumnValueFilterValue;
  onChange: (value: ColumnValueFilterValue) => void;
}

const VIEWPORT_MARGIN = 12;
const PANEL_WIDTH = 220;

// Header-triggered free-form filter for columns that don't have a small fixed set of values:
// "contains" text, a from/to date range, or a min/max number range. Same portal + fixed-position
// approach as ColumnFilterMenu (the header row has overflow-x:hidden, so an in-flow panel would be
// clipped). Changes apply as the user types/picks — no confirm step — matching the other header
// filters.
export function ColumnValueFilter({ kind, value, onChange }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        panelRef.current && !panelRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }
    function handleScroll(e: Event) {
      if (panelRef.current && panelRef.current.contains(e.target as Node)) return;
      setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen]);

  function toggleOpen(e: ReactMouseEvent) {
    e.stopPropagation();
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(rect.left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN);
    setPosition({ top: rect.bottom + 4, left: Math.max(VIEWPORT_MARGIN, left) });
    setIsOpen(true);
  }

  const isActive = kind === 'text' ? !!value.text : !!value.from || !!value.to;
  const inputType = kind === 'date' ? 'date' : 'number';

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`column-filter-icon${isActive ? ' active' : ''}`}
        onClick={toggleOpen}
        title="Filter"
      >
        <FilterIcon />
      </button>
      {isOpen && position &&
        createPortal(
          <div
            className="column-filter-panel"
            ref={panelRef}
            style={{ top: position.top, left: position.left, width: PANEL_WIDTH }}
            onClick={(e) => e.stopPropagation()}
          >
            {kind === 'text' ? (
              <input
                type="text"
                className="column-filter-search"
                placeholder="Contains…"
                value={value.text ?? ''}
                onChange={(e) => onChange({ text: e.target.value })}
                autoFocus
              />
            ) : (
              <div className="column-filter-range">
                <label>
                  {kind === 'date' ? 'From' : 'Min'}
                  <input
                    type={inputType}
                    step={kind === 'number' ? 'any' : undefined}
                    value={value.from ?? ''}
                    onChange={(e) => onChange({ from: e.target.value, to: value.to })}
                    autoFocus
                  />
                </label>
                <label>
                  {kind === 'date' ? 'To' : 'Max'}
                  <input
                    type={inputType}
                    step={kind === 'number' ? 'any' : undefined}
                    value={value.to ?? ''}
                    onChange={(e) => onChange({ from: value.from, to: e.target.value })}
                  />
                </label>
              </div>
            )}
            {isActive && (
              <button type="button" className="column-filter-clear" onClick={() => onChange({})}>
                Clear
              </button>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
