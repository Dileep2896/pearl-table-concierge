import { motion } from 'motion/react';
import type { Intent, Slot, Venue, VenueAvailability } from '../../lib/api';
import { timeLabel } from '../../lib/format';
import { riseItem } from '../../lib/motion';
import { SlotChip } from './SlotChip';
import { Icon } from '../../ui/Icon';
export function VenueCard({ entry, intent, selected, onPick }: { entry: VenueAvailability; intent: Intent; selected?: Slot; onPick: (v: Venue, s: Slot) => void }) {
  const { venue } = entry;
  const bookable = entry.slots.filter(s => s.type === 'book');
  const site = `https://www.sevenrooms.com/explore/${venue.slug}/reservations/create/search?date=${intent.date}&party_size=${intent.partySize}&time=${intent.timeFrom ?? intent.exactTime}`;
  return <motion.article layout variants={riseItem} className="venue">
    <div className="venue-head">
      <div><h3>{venue.name}</h3><p className="venue-meta"><Icon name="pin" size={14} />{venue.neighborhood}, {venue.city} · {venue.cuisine}</p></div>
      <a href={site} target="_blank" rel="noreferrer" className="verify">On SevenRooms</a>
    </div>
    {entry.error && <p className="muted quiet">We couldn’t reach this restaurant just now.</p>}
    {!entry.error && !entry.slots.length && <p className="muted quiet">No tables in this window.</p>}
    {intent.exactTime && entry.pick && <div className="pickrow">
      <motion.button whileTap={{ scale: 0.98 }} className={`pickbtn ${selected === entry.pick ? 'on' : ''}`} onClick={() => onPick(venue, entry.pick!)}>
        <span className="pickbtn-time">{entry.pick.label}</span>
        <span className="pickbtn-sub">{entry.pick.time !== intent.exactTime ? `closest to ${timeLabel(intent.exactTime)}` : 'your time'}{entry.pick.area ? ` · ${entry.pick.area}` : ''}</span>
        <Icon name="arrow" size={18} />
      </motion.button>
      {bookable.length > 1 && <details className="others"><summary>Other times</summary><div className="chips">{entry.slots.filter(s => s !== entry.pick).map(s => <SlotChip key={s.time} slot={s} selected={selected === s} onPick={x => onPick(venue, x)} />)}</div></details>}
    </div>}
    {intent.exactTime && !entry.pick && entry.slots.length > 0 && <p className="muted quiet">Only by-request times near {timeLabel(intent.exactTime)}.</p>}
    {!intent.exactTime && entry.slots.length > 0 && <div className="chips">{entry.slots.map(s => <SlotChip key={s.time} slot={s} selected={selected === s} onPick={x => onPick(venue, x)} />)}</div>}
  </motion.article>;
}
