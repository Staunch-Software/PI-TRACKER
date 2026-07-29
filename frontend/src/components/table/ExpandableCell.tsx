import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

const POPOVER_WIDTH = 340;
const VIEWPORT_MARGIN = 12;

export function ExpandableCell({ text, lines = 2 }: { text: string | null; lines?: number }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  // Tracks whether the popover was opened by a click (stays open until an outside click) as
  // opposed to just a hover preview (closes as soon as the mouse leaves) — otherwise a click
  // to "pin" it open would get immediately undone by the mouseleave that follows.
  const pinnedRef = useRef(false);
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
        pinnedRef.current = false;
        setPosition(null);
      }
    }
    function handleScroll() {
      pinnedRef.current = false;
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

  function computePosition() {
    const rect = textRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN);
    setPosition({ top: rect.bottom + 4, left: Math.max(VIEWPORT_MARGIN, left) });
  }

  function handleClick() {
    if (position) {
      pinnedRef.current = false;
      setPosition(null);
      return;
    }
    pinnedRef.current = true;
    computePosition();
  }

  function handleMouseEnter() {
    if (!position) computePosition();
  }

  function handleMouseLeave() {
    if (position && !pinnedRef.current) setPosition(null);
  }

  return (
    <div className="expandable-cell">
      <div
        className="expandable-cell-text"
        ref={textRef}
        style={{ WebkitLineClamp: lines, lineClamp: lines } as CSSProperties}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {text}
      </div>
      {position &&
        createPortal(
          <div
            className="expandable-cell-popover"
            ref={popoverRef}
            style={{ top: position.top, left: position.left }}
            onMouseLeave={handleMouseLeave}
          >
            {text}
          </div>,
          document.body
        )}
    </div>
  );
}
