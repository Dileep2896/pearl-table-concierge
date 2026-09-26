/** The house mark: a single lit orb. */
export function Tavola({ size = 76 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 80 80" fill="none" className="tavola-mark" aria-hidden="true">
    <defs>
      <radialGradient id="tavola-sheen" cx="38%" cy="34%" r="72%">
        <stop offset="0%" stopColor="var(--brass-bright)" />
        <stop offset="42%" stopColor="var(--brass)" />
        <stop offset="100%" stopColor="color-mix(in oklab, var(--brass) 40%, #000)" />
      </radialGradient>
    </defs>
    <circle cx="40" cy="40" r="30" fill="url(#tavola-sheen)" />
    <ellipse cx="31" cy="29" rx="10" ry="7" fill="var(--brass-bright)" opacity="0.55" />
    <circle cx="40" cy="40" r="37" stroke="var(--brass)" strokeWidth="0.75" opacity="0.35" />
  </svg>;
}
