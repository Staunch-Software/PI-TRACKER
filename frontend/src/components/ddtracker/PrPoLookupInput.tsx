import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { PoLookupResult, PrLookupResult } from '../../shared';

// Server-side typeahead for the PR/PO Number cells — covers orders SmartPAL never labelled "DD"
// (e.g. OPEX-categorized items), where the team still wants to link/track them here manually.
// Typing 2+ characters searches /dd-tracker/pr-lookup or /dd-tracker/po-lookup (matches against
// the requisition/PO number AND title); picking a result fills in the number plus the PR/PO's
// own vessel + title, same "other details" the plain text field never had access to. Free typing
// without picking anything still works (e.g. the "direct PO, no matching PR" case), it just
// doesn't get live vessel/title autofill.
//
// Modelled on SearchableSelect, but anchored to a text <input> the user types into directly
// instead of a trigger button, and backed by a debounced server query instead of filtering an
// already-fetched option list (PR/PO entries number in the thousands — too many to prefetch).
type LookupKind = 'pr' | 'po';
type LookupResult<K extends LookupKind> = K extends 'pr' ? PrLookupResult : PoLookupResult;

interface Props<K extends LookupKind> {
  kind: K;
  value: string;
  onChange: (value: string) => void;
  onPick: (result: LookupResult<K>) => void;
  autoFocus?: boolean;
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;
const VISIBLE_OPTIONS = 6;
const OPTION_HEIGHT = 48;
const VIEWPORT_MARGIN = 12;
const MIN_PANEL_WIDTH = 280;

function resultNumber(kind: LookupKind, result: PrLookupResult | PoLookupResult): string {
  return kind === 'pr' ? (result as PrLookupResult).requisitionNo : (result as PoLookupResult).poNo;
}

function resultStatus(kind: LookupKind, result: PrLookupResult | PoLookupResult): string | null {
  return kind === 'pr' ? (result as PrLookupResult).status : (result as PoLookupResult).approvedStatus;
}

export function PrPoLookupInput<K extends LookupKind>({ kind, value, onChange, onPick, autoFocus }: Props<K>) {
  const [isOpen, setIsOpen] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState(value);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(value), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value]);

  const trimmed = debouncedQuery.trim();
  const enabled = isOpen && trimmed.length >= MIN_QUERY_LENGTH;

  const lookupQuery = useQuery<(PrLookupResult | PoLookupResult)[]>({
    queryKey: ['dd-tracker-lookup', kind, trimmed],
    queryFn: () =>
      kind === 'pr'
        ? api.get<PrLookupResult[]>(`/dd-tracker/pr-lookup?q=${encodeURIComponent(trimmed)}`)
        : api.get<PoLookupResult[]>(`/dd-tracker/po-lookup?q=${encodeURIComponent(trimmed)}`),
    enabled,
    placeholderData: (prev: (PrLookupResult | PoLookupResult)[] | undefined) => prev,
  });

  const results = (enabled ? lookupQuery.data : undefined) ?? [];

  function updatePosition() {
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, MIN_PANEL_WIDTH);
    const left = Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN);
    const estimatedHeight = Math.min(Math.max(results.length, 1), VISIBLE_OPTIONS) * OPTION_HEIGHT + 2;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUpward = spaceBelow < estimatedHeight + VIEWPORT_MARGIN && spaceAbove > spaceBelow;
    const top = openUpward ? Math.max(VIEWPORT_MARGIN, rect.top - estimatedHeight - 4) : rect.bottom + 4;
    setPosition({ top, left: Math.max(VIEWPORT_MARGIN, left), width });
  }

  useEffect(() => {
    if (!isOpen) {
      setPosition(null);
      return;
    }
    updatePosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, results.length]);

  useEffect(() => {
    if (!isOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!inputRef.current?.contains(t) && !panelRef.current?.contains(t)) setIsOpen(false);
    }
    function onScroll(e: Event) {
      if (panelRef.current && panelRef.current.contains(e.target as Node)) return;
      setIsOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', updatePosition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function pick(result: PrLookupResult | PoLookupResult) {
    onChange(resultNumber(kind, result));
    onPick(result as LookupResult<K>);
    setIsOpen(false);
  }

  const showPanel = isOpen && trimmed.length >= MIN_QUERY_LENGTH;

  return (
    <>
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={value}
        placeholder={kind === 'pr' ? 'PR number or title…' : 'PO number or title…'}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
      />
      {showPanel &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            className="searchable-select-panel lookup-panel"
            style={{ top: position.top, left: position.left, width: position.width }}
          >
            <div className="searchable-select-list" style={{ maxHeight: OPTION_HEIGHT * VISIBLE_OPTIONS }}>
              {lookupQuery.isFetching && results.length === 0 ? (
                <div className="searchable-select-empty">Searching…</div>
              ) : results.length === 0 ? (
                <div className="searchable-select-empty">No matches — you can still type a value manually.</div>
              ) : (
                results.map((r) => {
                  const number = resultNumber(kind, r);
                  const status = resultStatus(kind, r);
                  return (
                    <div
                      key={number}
                      className="searchable-select-option lookup-option"
                      // Prevents the input from blurring on mousedown, so the cell's own
                      // click-outside-to-save (DdTrackerTable.tsx's handleCellBlur) never fires
                      // before onPick has finished filling in the rest of the row.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(r)}
                    >
                      <div className="lookup-option-primary">
                        <span>{number}</span>
                        {status && <span className="lookup-option-status">{status}</span>}
                      </div>
                      <div className="lookup-option-secondary">
                        {[r.title, r.vesselName].filter(Boolean).join(' • ') || '—'}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
