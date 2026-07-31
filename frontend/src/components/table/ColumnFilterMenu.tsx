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
}

const VIEWPORT_MARGIN = 12;
const PANEL_WIDTH = 200;

// Header-triggered multi-select filter (e.g. Currency). Rendered via a portal into document.body
// (position:fixed), same approach as SearchableSelect — the header row it lives in
// (.table-header-scroll) has overflow-x:hidden, so a plain absolutely-positioned panel would be
// clipped the moment it extended past the header's own bounds.
export function ColumnFilterMenu({ options, selected, onChange }: Props) {
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

  function toggleValue(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  const isActive = selected.length > 0;

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
            <label className="multi-select-option multi-select-all">
              <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
              All
            </label>
            <div className="multi-select-list">
              {options.map((option) => (
                <label className="multi-select-option" key={option.value}>
                  <input
                    type="checkbox"
                    checked={selected.includes(option.value)}
                    onChange={() => toggleValue(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
