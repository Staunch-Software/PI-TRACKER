import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FilterIcon } from './FilterIcon';

interface Props {
  activeCount: number;
  children: ReactNode;
}

// Generic collapsible filter panel — houses every toolbar filter except Search/Status (which stay
// always visible) so the toolbar never sprawls across 6+ controls and wraps onto a second line.
// Simple relative/absolute positioning (unlike ColumnFilterMenu's portal) is fine here since the
// toolbar itself has no overflow-hidden ancestor to clip against.
export function MoreFiltersPopover({ activeCount, children }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="more-filters" ref={wrapRef}>
      <button type="button" className={`btn btn-secondary${activeCount > 0 ? ' more-filters-active' : ''}`} onClick={() => setIsOpen((v) => !v)}>
        <FilterIcon /> More filters{activeCount > 0 ? ` (${activeCount})` : ''}
      </button>
      {isOpen && <div className="more-filters-panel">{children}</div>}
    </div>
  );
}
