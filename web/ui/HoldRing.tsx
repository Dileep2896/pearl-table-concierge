import { clock } from '../lib/format';
/** A thin brass ring that drains as the restaurant's hold counts down. */
export function HoldRing({ seconds, total, label }: { seconds: number; total: number; label?: string }) {
  const r = 26, c = 2 * Math.PI * r, frac = Math.max(0, Math.min(1, seconds / total));
  const low = seconds <= 45;
  return <div className={`hold-ring ${low ? 'low' : ''}`}>
    <svg width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
      <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 32 32)" style={{ transition: 'stroke-dashoffset 1s linear' }} />
    </svg>
    <div className="hold-ring-text"><span className="tnum">{clock(seconds)}</span>{label && <small>{label}</small>}</div>
  </div>;
}
