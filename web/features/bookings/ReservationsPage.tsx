import { motion } from 'motion/react';
import { useStore } from '../../store/store';
import { dayLabel, timeLabel } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Button } from '../../ui/Button';
import { riseItem, stagger } from '../../lib/motion';

export function ReservationsPage() {
  const bookings = useStore(s => s.bookings);
  const setPage = useStore(s => s.setPage);
  return <div className="page">
    <header className="page-head"><h1>Reservations</h1><p className="muted">Tables you’ve confirmed through Tavola.</p></header>
    {!bookings.length ? (
      <div className="empty">
        <Icon name="book" size={30} />
        <p>No reservations yet.</p>
        <Button onClick={() => setPage('concierge')}>Find a table</Button>
      </div>
    ) : (
      <motion.ul className="res-list" variants={stagger(0, 0.06)} initial="hidden" animate="show">
        {bookings.map(b => <motion.li key={b.id} variants={riseItem} className="res-card">
          <div className="res-when"><span className="res-day">{dayLabel(b.date)}</span><span className="res-time">{timeLabel(b.time)}</span></div>
          <div className="res-main"><h3>{b.venueName}</h3><p className="muted"><Icon name="pin" size={13} />{b.city} · {b.partySize} guests</p></div>
          <div className="res-side">{b.reference && <span className="ref">{b.reference}</span>}{b.pageUrl && <a href={b.pageUrl} target="_blank" rel="noreferrer" className="verify">Manage</a>}</div>
        </motion.li>)}
      </motion.ul>
    )}
    {bookings.length > 0 && <p className="muted quiet foot-note">To change or cancel, use the restaurant’s confirmation message.</p>}
  </div>;
}
