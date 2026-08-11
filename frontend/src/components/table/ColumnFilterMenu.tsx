import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { FilterIcon } from '../common/FilterIcon';

export interface ColumnFilterOption {
  value: string;
  label: string;
}

interface Props {
  options: ColumnFilterOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  // 'multi' (default, e.g. Currency): checkboxes, panel stays open across picks. 'single' (e.g.
  // Vendor): clicking a row immediately applies that one value and closes the panel — no
  // checkbox, no "confirm" step.
  mode?: 'multi' | 'single';
}

const VIEWPORT_MARGIN = 12;
const PANEL_WIDTH = 220;

// Header-triggered filter (e.g. Currency, Vendor). Rendered via a portal into document.body
// (position:fixed), same approach as SearchableSelect — the header row it lives in
// (.table-header-scroll) has overflow-x:hidden, so a plain absolutely-positioned panel would be
// clipped the moment it extended past the header's own bounds.
export function ColumnFilterMenu({ options, selected, onChange, mode = 'multi' }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [query, setQuery] = useState('');
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
    setQuery('');
    setIsOpen(true);
  }

  function toggleValue(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  function pickSingle(value: string) {
    // Clicking the already-selected row clears the filter instead of re-picking it — otherwise
    // there'd be no way to get back to "All" without reopening the panel and using a separate
    // control.
    onChange(selected.includes(value) ? [] : [value]);
    setIsOpen(false);
  }

  const isActive = selected.length > 0;
  const filteredOptions = query.trim()
    ? options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

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
            <input
              type="text"
              className="column-filter-search"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {mode === 'single' ? (
              <>
                <div
                  className={`single-select-option single-select-all${selected.length === 0 ? ' selected' : ''}`}
                  onClick={() => {
                    onChange([]);
                    setIsOpen(false);
                  }}
                >
                  All
                </div>
                <div className="multi-select-list">
                  {filteredOptions.map((option) => (
                    <div
                      className={`single-select-option${selected.includes(option.value) ? ' selected' : ''}`}
                      key={option.value}
                      onClick={() => pickSingle(option.value)}
                    >
                      {option.label}
                    </div>
                  ))}
                  {filteredOptions.length === 0 && <div className="multi-select-empty">No matches</div>}
                </div>
              </>
            ) : (
              <>
                <label className="multi-select-option multi-select-all">
                  <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
                  All
                </label>
                <div className="multi-select-list">
                  {filteredOptions.map((option) => (
                    <label className="multi-select-option" key={option.value}>
                      <input
                        type="checkbox"
                        checked={selected.includes(option.value)}
                        onChange={() => toggleValue(option.value)}
                      />
                      {option.label}
                    </label>
                  ))}
                  {filteredOptions.length === 0 && <div className="multi-select-empty">No matches</div>}
                </div>
              </>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
