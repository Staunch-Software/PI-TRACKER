import { useState, useRef, useEffect, useLayoutEffect, ReactNode } from 'react';

export interface ModernDropdownOption {
  value: string;
  label: string;
  sublabel?: string;
  badge?: ReactNode;
  icon?: ReactNode;
}

interface ModernDropdownProps {
  options: ModernDropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  align?: 'left' | 'right' | 'auto';
}

export function ModernDropdown({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  disabled = false,
  className = '',
  ariaLabel,
  align = 'auto',
}: ModernDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelAlign, setPanelAlign] = useState<'left' | 'right'>(align === 'right' ? 'right' : 'left');

  const selectedOption = options.find((o) => o.value === value);
  const displayLabel = selectedOption ? selectedOption.label : placeholder;
  const hasValue = Boolean(selectedOption && selectedOption.value !== '' && selectedOption.value !== 'ALL');

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen]);

  // Adjust alignment before paint to never overflow the viewport or page boundary
  useLayoutEffect(() => {
    if (!isOpen) return;

    if (align === 'right') {
      setPanelAlign('right');
      return;
    }
    if (align === 'left') {
      setPanelAlign('left');
      return;
    }

    // Auto-detect: check whether left: 0 would exceed viewport right edge
    function updateAlignment() {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const panelWidth = panelRef.current?.offsetWidth || 220;
      const viewportWidth = window.innerWidth;

      // If panel starting from rect.left would exceed the right viewport boundary
      if (rect.left + panelWidth > viewportWidth - 24 || rect.right > viewportWidth - 140) {
        setPanelAlign('right');
      } else {
        setPanelAlign('left');
      }
    }

    updateAlignment();
    window.addEventListener('resize', updateAlignment);
    return () => window.removeEventListener('resize', updateAlignment);
  }, [isOpen, align]);

  function handleSelect(val: string) {
    onChange(val);
    setIsOpen(false);
  }

  return (
    <div
      ref={containerRef}
      className={`modern-card-dropdown ${hasValue ? 'has-value' : ''} ${isOpen ? 'is-open' : ''} ${panelAlign === 'right' ? 'align-right' : 'align-left'} ${disabled ? 'is-disabled' : ''} ${className}`}
    >
      <button
        type="button"
        className="modern-dropdown-trigger"
        onClick={() => {
          if (disabled) return;
          if (!isOpen && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            if (align === 'right' || (align === 'auto' && (rect.right > window.innerWidth - 140 || rect.left + 220 > window.innerWidth - 20))) {
              setPanelAlign('right');
            } else if (align === 'left') {
              setPanelAlign('left');
            }
          }
          setIsOpen(!isOpen);
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel || displayLabel}
      >
        <span className="modern-dropdown-trigger-content">
          {selectedOption?.icon && <span className="modern-dropdown-icon">{selectedOption.icon}</span>}
          <span className="modern-dropdown-label">{displayLabel}</span>
          {selectedOption?.badge && <span className="modern-dropdown-badge">{selectedOption.badge}</span>}
        </span>
        <svg
          className={`modern-dropdown-arrow ${isOpen ? 'open' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          className={`modern-dropdown-panel ${panelAlign === 'right' ? 'align-right' : 'align-left'}`}
          role="listbox"
        >
          <div className="modern-dropdown-list">
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <div
                  key={opt.value || '__all__'}
                  role="option"
                  aria-selected={isSelected}
                  className={`modern-dropdown-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleSelect(opt.value)}
                >
                  <div className="modern-dropdown-item-left">
                    {opt.icon && <span className="modern-dropdown-item-icon">{opt.icon}</span>}
                    <div>
                      <div className="modern-dropdown-item-title">{opt.label}</div>
                      {opt.sublabel && <div className="modern-dropdown-item-sublabel">{opt.sublabel}</div>}
                    </div>
                  </div>
                  <div className="modern-dropdown-item-right">
                    {opt.badge && <span className="modern-dropdown-badge">{opt.badge}</span>}
                    {isSelected && (
                      <svg
                        className="modern-dropdown-check"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
