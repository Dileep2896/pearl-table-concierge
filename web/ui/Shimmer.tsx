/** A candlelit shimmer sweep for loading venue cards. */
export function Shimmer({ lines = 2 }: { lines?: number }) {
  return <div className="shimmer-card" aria-hidden="true">
    <div className="shimmer-row"><span className="sh sh-title" /><span className="sh sh-tag" /></div>
    <div className="shimmer-chips">{Array.from({ length: 5 }).map((_, i) => <span key={i} className="sh sh-chip" />)}</div>
    {lines > 2 && <span className="sh sh-line" />}
  </div>;
}
