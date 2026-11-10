import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface ToastProps {
  message: string;
  type?: 'error' | 'success' | 'info';
  onClose: () => void;
  duration?: number;
}

export function Toast({ message, type = 'error', onClose, duration = 4000 }: ToastProps) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const isSuccess = type === 'success';
  const isError = type === 'error';

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        background: '#ffffff',
        color: '#1e293b',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        padding: '9px 14px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: 460,
        fontSize: 13,
        fontWeight: 500,
        lineHeight: 1.4,
        animation: 'simpleToastIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Simple Status Icon */}
      {isSuccess ? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#0f4c81"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : isError ? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#dc2626"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      ) : (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#0f4c81"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      )}

      {/* Clean Message Text */}
      <span style={{ flex: 1, wordBreak: 'break-word' }}>{message}</span>

      {/* Dismiss Button */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#94a3b8',
          cursor: 'pointer',
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          borderRadius: 4,
          lineHeight: 1,
          transition: 'color 0.15s ease',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#334155')}
        onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <style>{`
        @keyframes simpleToastIn {
          from {
            transform: translate(-50%, -12px);
            opacity: 0;
          }
          to {
            transform: translate(-50%, 0);
            opacity: 1;
          }
        }
      `}</style>
    </div>,
    document.body
  );
}
