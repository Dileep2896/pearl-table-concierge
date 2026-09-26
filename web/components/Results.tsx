import { timeLabel, type Intent, type Slot, type Venue, type VenueAvailability } from '../api';

type Props = { results: VenueAvailability[]; intent: Intent; selected?: Slot; onPick: (venue: Venue, slot: Slot) => void };

function Chip({ slot, selected, onPick }: { slot: Slot; selected?: Slot; onPick: (slot: Slot) => void }) {
  return <button type="button" className={`chip ${slot.type} ${selected === slot ? 'on' : ''}`} disabled={slot.type !== 'book'} title={slot.type === 'book' ? slot.area : 'Request only on SevenRooms'} onClick={() => onPick(slot)}>{slot.label}{slot.area && slot.type === 'book' ? <small>{slot.area}</small> : slot.type === 'request' ? <small>request</small> : null}</button>;
}

/** One card per restaurant. With a named time Pearl's pick is the big button; with a window every time is a chip. */
export function Results({ results, intent, selected, onPick }: Props) {
  return <section className="results">
    {results.map(entry => <article key={entry.venue.slug} className="venue">
      <div className="venue-head"><div><h2>{entry.venue.name}</h2><p>{entry.venue.cuisine} · {entry.venue.address}, {entry.venue.neighborhood}, {entry.venue.city}</p></div><a href={`https://www.sevenrooms.com/explore/${entry.venue.slug}/reservations/create/search?date=${intent.date}&party_size=${intent.partySize}&time=${intent.timeFrom}`} target="_blank" rel="noreferrer" title="Opens the restaurant's live SevenRooms page for this date">Verify on SevenRooms</a></div>
      {entry.error && <p className="muted">Could not check this restaurant right now.</p>}
      {!entry.error && !entry.slots.length && <p className="muted">No tables in this window.</p>}
      {intent.exactTime && entry.pick && <div className="pickrow">
        <button type="button" className={`pickbtn ${selected === entry.pick ? 'on' : ''}`} onClick={() => onPick(entry.venue, entry.pick!)}>Book {entry.pick.label}{entry.pick.time !== intent.exactTime && <small>closest to {timeLabel(intent.exactTime)}</small>}{entry.pick.area && <small>{entry.pick.area}</small>}</button>
        {entry.slots.filter(s => s.type === 'book').length > 1 && <details className="others"><summary>Other times</summary><div className="chips">{entry.slots.filter(s => s !== entry.pick).map(slot => <Chip key={slot.time} slot={slot} selected={selected} onPick={s => onPick(entry.venue, s)} />)}</div></details>}
      </div>}
      {intent.exactTime && !entry.pick && entry.slots.length > 0 && <p className="muted">Only request-only times near {timeLabel(intent.exactTime)}.</p>}
      {!intent.exactTime && <div className="chips">{entry.slots.map(slot => <Chip key={slot.time} slot={slot} selected={selected} onPick={s => onPick(entry.venue, s)} />)}</div>}
    </article>)}
  </section>;
}
