import { useStore } from '../../store/store';
import { shortDay, timeLabel } from '../../lib/format';
import { Icon } from '../../ui/Icon';
export function BookingsList() {
  const bookings = useStore(s => s.bookings);
  if (!bookings.length) return null;
  return <details className="bookings">
    <summary><Icon name="book" size={15} />Your reservations<span className="count">{bookings.length}</span></summary>
    <ul>{bookings.map(b => <li key={b.id}><span><strong>{b.venueName}</strong> — {shortDay(b.date)}, {timeLabel(b.time)} · {b.partySize} guests</span>{b.reference && <span className="ref">{b.reference}</span>}</li>)}</ul>
    <p className="muted quiet">To change or cancel, use the restaurant’s confirmation message.</p>
  </details>;
}
