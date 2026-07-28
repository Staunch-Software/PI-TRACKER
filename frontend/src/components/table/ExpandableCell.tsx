import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const POPOVER_WIDTH = 340;
const VIEWPORT_MARGIN = 12;

export function ExpandableCell({ text, width }: { text: string | null; width: number }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!position) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        textRef.current && !textRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setPosition(null);
      }
    }
    function handleScroll() {
      setPosition(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [position]);

  if (!text) return <>—</>;

  function handleClick() {
    if (position) {
      setPosition(null);
      return;
    }
    const rect = textRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN);
    setPosition({ top: rect.bottom + 4, left: Math.max(VIEWPORT_MARGIN, left) });
  }

  return (
    <div className="expandable-cell" style={{ width }}>
      <div className="expandable-cell-text" ref={textRef} onClick={handleClick}>
        {text}
      </div>
      {position &&
        createPortal(
          <div
            className="expandable-cell-popover"
            ref={popoverRef}
            style={{ top: position.top, left: position.left }}
          >
            {text}
          </div>,
          document.body
        )}
    </div>
  );
}
