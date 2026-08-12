export function SpinnerIcon({ size = 24, color = "currentColor" }: { size?: number, color?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="spin-animation">
      <style>{`
        .spin-animation { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
      <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
    </svg>
  );
}
