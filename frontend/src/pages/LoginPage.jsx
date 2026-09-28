import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiError, useAuth } from '../auth/AuthContext';
import marineHero from '../assets/marine-hero.jpg';
import './LoginPage.css';

// Existing SVG Icons
const MailIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="16" x="2" y="4" rx="2"/>
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
  </svg>
);

const LockIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);

const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const EyeOffIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
    <line x1="2" x2="22" y1="2" y2="22"/>
  </svg>
);

// New Marine Brand Icon (Anchor with PI)
const BrandIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="url(#brandGrad)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="marine-brand-icon">
    <defs>
      <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#0f4c81" />
        <stop offset="100%" stopColor="#FFFFFF" />
      </linearGradient>
      <filter id="glow">
        <feGaussianBlur stdDeviation="1" result="coloredBlur"/>
        <feMerge>
          <feMergeNode in="coloredBlur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <circle cx="12" cy="5" r="3" filter="url(#glow)"/>
    <line x1="12" y1="22" x2="12" y2="8" filter="url(#glow)"/>
    <path d="M5 12H2a10 10 0 0 0 20 0h-3" filter="url(#glow)"/>
    
    {/* Added PI letters integrated into the anchor, zero gap to center stem */}
    <text x="11.2" y="15" fontSize="7" fontWeight="900" fill="url(#brandGrad)" stroke="none" textAnchor="end" filter="url(#glow)">P</text>
    <text x="12.8" y="15" fontSize="7" fontWeight="900" fill="url(#brandGrad)" stroke="none" textAnchor="start" filter="url(#glow)">I</text>
  </svg>
);

export function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid credentials. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="marine-login-layout">
      {/* Left Side: Image & Rich Overlay */}
      <div className="marine-hero-side">
        <img src={marineHero} alt="Ozellar Marine Vessel" className="marine-hero-img" />
        <div className="marine-hero-overlay">

          {/* Top: Company tag */}
          <div className="marine-hero-top">
            <span className="marine-hero-top-label">Ozellar Marine</span>
          </div>


          {/* Bottom: Project branding */}
          <div className="marine-hero-branding">
            <BrandIcon />
            <div className="marine-hero-text">
              <h1>PI Tracker</h1>
              <p className="marine-hero-subtitle">Proforma Invoice Management System</p>
            </div>
          </div>

        </div>
      </div>

      {/* Right Side: Elegant UI Form */}
      <div className="marine-form-side">
        <div className="marine-form-wrapper">

          {/* Company Branding at top */}
          <div className="marine-company-brand">
            <div className="marine-company-logo">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="5" r="3" stroke="#0f4c81" strokeWidth="1.5"/>
                <line x1="12" y1="22" x2="12" y2="8" stroke="#0f4c81" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M5 12H2a10 10 0 0 0 20 0h-3" stroke="#0f4c81" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="8" y1="12" x2="16" y2="12" stroke="#0f4c81" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <p className="marine-company-name">Ozellar Marine</p>
              <p className="marine-company-tag">Enterprise Portal</p>
            </div>
          </div>

          {/* Divider */}
          <div className="marine-divider"></div>

          <div className="marine-form-header">
            <h2>Welcome Back</h2>
            <p>Sign in to access the PI Tracker system.</p>
          </div>

          <form onSubmit={handleSubmit} className="marine-form">
            <div className="marine-input-group">
              <label htmlFor="email">Email</label>
              <div className="marine-input-wrapper">
                <span className="marine-input-icon"><MailIcon /></span>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="name@ozellar.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="marine-input-group">
              <label htmlFor="password">Password</label>
              <div className="marine-input-wrapper">
                <span className="marine-input-icon"><LockIcon /></span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="marine-password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            {error && <div className="marine-error-alert">{error}</div>}

            <button type="submit" className="marine-submit-btn" disabled={isSubmitting}>
              {isSubmitting ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>

          <div className="marine-professional-details">
            <p>Authorized Personnel Only &mdash; &copy; 2026 Ozellar Marine</p>
          </div>
        </div>
      </div>
    </div>
  );
}
