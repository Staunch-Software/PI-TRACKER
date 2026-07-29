import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface Props {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

// Only ~4 options are visible at once — the rest are reachable by scrolling the list — so the
// panel stays a fixed, predictable size no matter how long the underlying option list grows
// (e.g. as more vessels/vendors get added over time).
const VISIBLE_OPTIONS = 4;
const OPTION_HEIGHT = 34;
const MIN_PANEL_WIDTH = 220;
const VIEWPORT_MARGIN = 12;
// Search input row height + the panel's own 1px top/bottom border — used to estimate the
// panel's total height up front (see open() below) so it can flip above the trigger before
// ever painting below the viewport, rather than rendering below and correcting after the fact.
const SEARCH_ROW_HEIGHT = 37;
const PANEL_BORDER = 2;

export function SearchableSelect({ options, value, onChange, placeholder = 'Select…', disabled }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        panelRef.current && !panelRef.current.contains(target)
      ) {
        close();
      }
    }
    // Rendered via a portal into document.body (position:fixed) so the panel isn't clipped by
    // the table's horizontally-scrolling body container — same approach as ExpandableCell's
    // popover. That means it has to close on scroll instead of trying to reposition, since a
    // scroll could come from the table body, the page, or both. But scrolling *inside* the
    // panel's own option list (to reach the options past the visible 4) is not one of those
    // cases — that scroll target is the panel itself, so it must not close it.
    function handleScroll(e: Event) {
      if (panelRef.current && panelRef.current.contains(e.target as Node)) return;
      close();
    }
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) searchRef.current?.focus();
  }, [isOpen]);

  function close() {
    setIsOpen(false);
    setQuery('');
  }

  function open() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, MIN_PANEL_WIDTH);
    const left = Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN);

    // Estimated off the full (unfiltered) option list, since that's the tallest the panel can
    // ever be right after opening (search always starts empty) — filtering can only shrink it
    // from there, so a decision made against this worst case never needs revisiting mid-search.
    const estimatedHeight = SEARCH_ROW_HEIGHT + Math.min(options.length, VISIBLE_OPTIONS) * OPTION_HEIGHT + PANEL_BORDER;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUpward = spaceBelow < estimatedHeight + VIEWPORT_MARGIN && spaceAbove > spaceBelow;
    const top = openUpward ? Math.max(VIEWPORT_MARGIN, rect.top - estimatedHeight - 4) : rect.bottom + 4;

    setPosition({ top, left: Math.max(VIEWPORT_MARGIN, left), width });
    setIsOpen(true);
  }

  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="searchable-select-trigger"
        disabled={disabled}
        onClick={() => (isOpen ? close() : open())}
      >
        <span className={selected ? 'searchable-select-value' : 'searchable-select-placeholder'}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="searchable-select-caret">▾</span>
      </button>
      {isOpen && position &&
        createPortal(
          <div
            className="searchable-select-panel"
            ref={panelRef}
            style={{ top: position.top, left: position.left, width: position.width }}
          >
            <input
              ref={searchRef}
              type="text"
              className="searchable-select-search"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="searchable-select-list" style={{ maxHeight: OPTION_HEIGHT * VISIBLE_OPTIONS }}>
              {filtered.length === 0 ? (
                <div className="searchable-select-empty">No matches</div>
              ) : (
                filtered.map((o) => (
                  <div
                    key={o.value}
                    className={`searchable-select-option${o.value === value ? ' selected' : ''}`}
                    onClick={() => {
                      onChange(o.value);
                      close();
                    }}
                  >
                    {o.label}
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
