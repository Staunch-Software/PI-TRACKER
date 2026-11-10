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

  // Palette configuration matching project theme
  const theme = isSuccess
    ? {
        label: 'Success',
        accentColor: '#10b981',
        iconBg: '#ecfdf5',
        iconBorder: '#a7f3d0',
        iconColor: '#059669',
        progressBarBg: 'linear-gradient(90deg, #10b981, #059669)',
      }
    : isError
    ? {
        label: 'Notice',
        accentColor: '#ef4444',
        iconBg: '#fef2f2',
        iconBorder: '#fecaca',
        iconColor: '#dc2626',
        progressBarBg: 'linear-gradient(90deg, #ef4444, #b91c1c)',
      }
    : {
        label: 'Update',
        accentColor: '#0284c7',
        iconBg: '#f0f9ff',
        iconBorder: '#bae6fd',
        iconColor: '#0284c7',
        progressBarBg: 'linear-gradient(90deg, #38bdf8, #0284c7)',
      };

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={`modern-toast-card ${isClosing ? 'toast-fade-out' : 'toast-slide-in'}`}
      style={{
        position: 'fixed',
        top: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10000,
        background: '#ffffff',
        borderRadius: 12,
        border: '1px solid #e2e8f0',
        boxShadow:
          '0 16px 36px -6px rgba(15, 23, 42, 0.16), 0 4px 12px -2px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.03)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px 10px 12px',
        minWidth: 320,
        maxWidth: 480,
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}
    >
      {/* Status Icon Badge */}
      <div
        style={{
          width: 32,
          height: 32,
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
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : isError ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        )}
      </div>

      {/* Message Text Content */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: theme.iconColor }}>
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

      {/* Modern Auto-Dismiss Progress Bar at bottom */}
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
