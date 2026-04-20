export function DoorIcon() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden="true">
      <rect x="1.5" y="1" width="7" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="7" cy="6" r="1" fill="currentColor"/>
    </svg>
  );
}

export function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden="true">
      <rect x="1.5" y="5.5" width="7" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="5" cy="8.2" r="1" fill="currentColor"/>
      {locked
        ? <path d="M3 5.5V3.8Q3 1.5 5 1.5Q7 1.5 7 3.8V5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        : <path d="M3 5.5V3.8Q3 1.5 5 1.5Q7 1.5 7 3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      }
    </svg>
  );
}

export function WeightIcon() {
  return (
    <svg width="12" height="8" viewBox="0 0 12 8" aria-hidden="true">
      <rect x="0" y="1" width="2.5" height="6" rx="0.5" fill="currentColor"/>
      <rect x="2.5" y="3" width="7" height="2" fill="currentColor"/>
      <rect x="9.5" y="1" width="2.5" height="6" rx="0.5" fill="currentColor"/>
    </svg>
  );
}

export function CenterOnRoomIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
      <circle cx="5.5" cy="5.5" r="1.5" fill="currentColor"/>
      <path d="M1 3V1h2M8 1h2v2M10 8v2H8M3 10H1V8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function CrosshairIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <circle cx="5" cy="5" r="2" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="5" y1="0" x2="5" y2="2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <line x1="5" y1="7.5" x2="5" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <line x1="0" y1="5" x2="2.5" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <line x1="7.5" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}
