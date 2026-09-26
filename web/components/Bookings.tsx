import { useEffect, useState } from 'react';
import { api, dayLabel, timeLabel, type LedgerEntry } from '../api';

/** Confirmed reservations from the local ledger. Refreshes whenever `version` changes. */
export function Bookings({ version }: { version: number }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  useEffect(() => { api.bookings().then(({ bookings }) => setEntries(bookings)).catch(() => {}); }, [version]);
  if (!entries.length) return null;
  return <details className="bookings"><summary>Your bookings ({entries.length})</summary>
    <ul>{entries.map(e => <li key={e.id}><strong>{e.venueName}</strong> · {dayLabel(e.date)} at {timeLabel(e.time)} · party of {e.partySize}{e.reference && <> · <span className="ref">{e.reference}</span></>}</li>)}</ul>
    <p className="muted">Cancel or change a booking from the restaurant’s confirmation email.</p>
  </details>;
}
