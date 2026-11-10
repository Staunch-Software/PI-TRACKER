import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ToastProps {
  message: string;
  type?: 'error' | 'success' | 'info';
  onClose: () => void;
  duration?: number;
}

export function Toast({ message, type = 'error', onClose, duration = 4500 }: ToastProps) {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setIsClosing(true);
        setTimeout(onClose, 200); // Allow fade-out animation to finish
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const handleManualClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 150);
  };

  const isSuccess = type === 'success';
  const isError = type === 'error';

  // Project Brand Color Theme (Maritime Deep Navy #0f4c81, Ocean Teal #14919b, Harbor Blue #0369a1)
  const theme = isSuccess
    ? {
        label: 'System Update',
        accentColor: '#0f4c81',
        iconBg: '#e0f2fe',
        iconBorder: '#bae6fd',
        iconColor: '#0f4c81',
        badgeColor: '#0f4c81',
        cardBorder: 'rgba(15, 76, 129, 0.22)',
        cardShadow: '0 16px 36px -6px rgba(15, 76, 129, 0.18), 0 4px 12px -2px rgba(15, 76, 129, 0.08)',
        progressBarBg: 'linear-gradient(90deg, #0f4c81 0%, #14919b 100%)',
      }
    : isError
    ? {
        label: 'Notice',
        accentColor: '#dc2626',
        iconBg: '#fee2e2',
        iconBorder: '#fca5a5',
        iconColor: '#dc2626',
        badgeColor: '#dc2626',
        cardBorder: 'rgba(220, 38, 38, 0.22)',
        cardShadow: '0 16px 36px -6px rgba(220, 38, 38, 0.16), 0 4px 12px -2px rgba(220, 38, 38, 0.06)',
        progressBarBg: 'linear-gradient(90deg, #dc2626, #b91c1c)',
      }
    : {
        label: 'Notification',
        accentColor: '#14919b',
        iconBg: '#f0fdfa',
        iconBorder: '#99f6e4',
        iconColor: '#14919b',
        badgeColor: '#14919b',
        cardBorder: 'rgba(20, 145, 155, 0.22)',
        cardShadow: '0 16px 36px -6px rgba(20, 145, 155, 0.16), 0 4px 12px -2px rgba(20, 145, 155, 0.06)',
        progressBarBg: 'linear-gradient(90deg, #14919b 0%, #0ea5e9 100%)',
      };

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={`project-theme-toast ${isClosing ? 'toast-fade-out' : 'toast-slide-in'}`}
      style={{
        position: 'fixed',
        top: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        background: '#ffffff',
        borderRadius: 12,
        border: `1px solid ${theme.cardBorder}`,
        borderLeft: `4px solid ${theme.accentColor}`,
        boxShadow: theme.cardShadow,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px 10px 12px',
        minWidth: 320,
        maxWidth: 500,
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}
    >
      {/* Brand Status Icon Badge */}
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          background: theme.iconBg,
          border: `1px solid ${theme.iconBorder}`,
          color: theme.iconColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {isSuccess ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : isError ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        )}
      </div>

      {/* Message Text Content */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: theme.badgeColor }}>
          {theme.label}
        </div>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#0f172a', lineHeight: 1.38, wordBreak: 'break-word' }}>
          {message}
        </div>
      </div>

      {/* Close Action Button */}
      <button
        type="button"
        onClick={handleManualClose}
        aria-label="Close notification"
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          color: '#94a3b8',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'all 0.15s ease',
          padding: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#f1f5f9';
          e.currentTarget.style.color = '#334155';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = '#94a3b8';
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Brand Gradient Progress Bar */}
      {duration > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            height: 2.5,
            width: '100%',
            background: theme.progressBarBg,
            animation: `toastProgressBar ${duration}ms linear forwards`,
          }}
        />
      )}

      {/* Animations */}
      <style>{`
        .toast-slide-in {
          animation: toastSlideIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .toast-fade-out {
          animation: toastFadeOut 0.18s ease-in forwards;
        }
        @keyframes toastSlideIn {
          from {
            transform: translate(-50%, -18px) scale(0.96);
            opacity: 0;
          }
          to {
            transform: translate(-50%, 0) scale(1);
            opacity: 1;
          }
        }
        @keyframes toastFadeOut {
          from {
            transform: translate(-50%, 0) scale(1);
            opacity: 1;
          }
          to {
            transform: translate(-50%, -10px) scale(0.97);
            opacity: 0;
          }
        }
        @keyframes toastProgressBar {
          from {
            width: 100%;
          }
          to {
            width: 0%;
          }
        }
      `}</style>
    </div>,
    document.body
  );
}
