import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';

interface Props<T> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (item: T) => void;
  searchPath: (q: string) => string;
  renderOption: (item: T) => { key: string; main: string; sub: string };
  placeholder?: string;
}

// Debounced autocomplete against /dd-tracker/pr-lookup or /dd-tracker/po-lookup — typing a
// requisition/PO number or title shows live matches scraped from SmartPAL, and picking one fills
// the rest of the form (see DdTrackerModal). Free typing without picking a suggestion is still
// allowed (the backend fields are plain text, not FKs — see dd_tracker_entry.py docstring), for a
// PR/PO SmartPAL hasn't been scraped yet.
export function DdTrackerLookupField<T>({ label, value, onChange, onSelect, searchPath, renderOption, placeholder }: Props<T>) {
  const [results, setResults] = useState<T[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(() => {
      api
        .get<T[]>(searchPath(value.trim()))
        .then((items) => {
          setResults(items);
          setIsOpen(true);
        })
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="field dd-lookup-field" ref={containerRef} style={{ position: 'relative' }}>
      <label>{label}</label>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => results.length > 0 && setIsOpen(true)}
        autoComplete="off"
      />
      {isOpen && results.length > 0 && (
        <ul className="dd-lookup-suggestions">
          {results.map((item) => {
            const { key, main, sub } = renderOption(item);
            return (
              <li
                key={key}
                onClick={() => {
                  onSelect(item);
                  setIsOpen(false);
                }}
              >
                <span className="dd-lookup-main">{main}</span>
                <span className="dd-lookup-sub">{sub}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
