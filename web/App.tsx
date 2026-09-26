import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, dayLabel, timeLabel, type BookingJob, type Contact, type Intent, type Message, type Slot, type Venue, type VenueAvailability } from './api';

type Selection = { venue: Venue; slot: Slot };
const stepText: Record<string, string> = { OPENING: 'Opening the restaurant’s booking page', SELECTING_TIME: 'Selecting your time', HOLDING: 'Holding the table for you', FILLING: 'Filling in your contact details', READY: 'Ready for your confirmation', SUBMITTING: 'Submitting the reservation', CONFIRMED: 'Confirmed', FAILED: 'Stopped' };
const busyStates = ['PREPARING', 'READY', 'SUBMITTING'];
const welcome: Message = { id: 'welcome', role: 'assistant', text: 'Tell me where, when, and for how many. I cover New York (West Village, Greenwich Village, Flatiron, Upper West Side) and San Francisco (Union Square, Jackson Square, Nob Hill, SoMa, Mission, Lower Haight, Financial District). Give me a window like “7–9pm” and I will show every open time; name one time like “at 7” and I will pick the closest table at each restaurant, so you only choose the restaurant.' };
const emptyContact: Contact = { firstName: '', lastName: '', email: '', phone: '' };
const profileComplete = (p: Contact) => Boolean(p.firstName && p.lastName && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email) && p.phone.replace(/\D/g, '').length >= 10);
type Theme = 'dark' | 'light';
function initialTheme(): Theme { try { const saved = localStorage.getItem('pearl-demo-theme'); if (saved === 'light' || saved === 'dark') return saved; } catch { /* private mode */ } return 'dark'; }

export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('pearl-demo-theme', theme); } catch { /* optional */ } }, [theme]);
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [intent, setIntent] = useState<Intent>({});
  const [results, setResults] = useState<VenueAvailability[] | null>(null);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [contact, setContact] = useState<Contact>(emptyContact);
  const [profileSaved, setProfileSaved] = useState<Contact>(emptyContact);
  const [editingProfile, setEditingProfile] = useState(false);
  const [job, setJob] = useState<BookingJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const feed = useRef<HTMLDivElement>(null);
  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' }); }, [messages, results, selection, job?.state]);
  useEffect(() => { api.profile().then(({ profile }) => { setContact(profile); setProfileSaved(profile); }).catch(() => {}); }, []);
  async function saveProfile(next: Contact) {
    const { profile } = await api.saveProfile(next);
    setContact(profile); setProfileSaved(profile); setEditingProfile(false);
  }
  // Poll while the browser is working or holding; fail loudly if the API disappears.
  useEffect(() => {
    if (!job || !busyStates.includes(job.state)) return;
    let misses = 0;
    const timer = setInterval(async () => {
      setTick(t => t + 1);
      try { const { job: next } = await api.job(job.id); misses = 0; setJob(next); }
      catch (e) {
        misses += 1;
        if (misses >= 8) setJob(current => current && busyStates.includes(current.state) ? { ...current, state: 'FAILED', result: { status: 'FAILED', code: 'API_UNREACHABLE', message: `Lost contact with the demo API (${e instanceof Error ? e.message : 'no response'}). If you had already confirmed, check your email. Run npm run demo again if it is not running.` } } : current);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [job?.id, job?.state]);
  useEffect(() => {
    if (!job || busyStates.includes(job.state) || job.state === 'CANCELLED') return;
    const done = job.result;
    setMessages(m => [...m, { id: `job-${job.id}-${job.state}`, role: 'assistant', text: job.state === 'CONFIRMED' ? `Booked: ${job.request.venue.name}, ${dayLabel(job.request.date)} at ${timeLabel(job.request.time)} for ${job.request.partySize}. ${done?.message ?? ''}` : `I could not complete that booking. ${done?.message ?? ''}` }]);
  }, [job?.state]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim(); if (!text || thinking) return;
    const next = [...messages, { id: `u-${Date.now()}`, role: 'user' as const, text }];
    setMessages(next); setDraft(''); setThinking(true); setError(null); setSelection(null);
    try {
      const reply = await api.chat(next, intent);
      setIntent(reply.intent); setResults(reply.results);
      setMessages(m => [...m, { id: `a-${Date.now()}`, role: 'assistant', text: reply.reply }]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong. Is the demo API running on port 8788?'); }
    finally { setThinking(false); }
  }
  /** Picking a time starts the browser straight away when the profile is complete; otherwise ask for details first. */
  async function pick(venue: Venue, slot: Slot) {
    setSelection({ venue, slot }); setError(null);
    if (profileComplete(contact)) await prepare(venue, slot, contact);
  }
  async function prepare(venue: Venue, slot: Slot, who: Contact) {
    if (!intent.date || !intent.partySize) return;
    if (JSON.stringify(who) !== JSON.stringify(profileSaved)) { try { await saveProfile(who); } catch { /* proceed with typed details */ } }
    try {
      const { job } = await api.prepare({ venue: venue.slug, date: intent.date, time: slot.time, partySize: intent.partySize, contact: who });
      setJob(job); setSelection(null);
      setMessages(m => [...m, { id: `b-${job.id}`, role: 'user', text: `${venue.name} at ${slot.label}.` }]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start. Is the demo API running on port 8788?'); }
  }
  async function confirm() {
    if (!job) return; setError(null);
    try { const { job: next } = await api.confirm(job.id); setJob(next); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not confirm.'); }
  }
  async function cancel() {
    if (!job) return;
    try { await api.cancel(job.id); } catch { /* already gone */ }
    setJob(null);
  }
  const holdLeft = job?.prepared ? Math.max(0, Math.round((Date.parse(job.prepared.holdExpiresAt) - Date.now()) / 1000)) : 0;
  void tick;

  return <div className="shell">
    <header className="top"><div><span className="eyebrow">Pearl</span><h1>Table concierge</h1></div><div className="side"><div className="facts">{intent.partySize && <span>{intent.partySize} guests</span>}{intent.date && <span>{dayLabel(intent.date)}</span>}{intent.exactTime ? <span>around {timeLabel(intent.exactTime)}</span> : intent.timeFrom && intent.timeTo && <span>{timeLabel(intent.timeFrom)} – {timeLabel(intent.timeTo)}</span>}{intent.neighborhood && <span>{intent.neighborhood}</span>}</div>
      <div className="profile">{profileComplete(profileSaved) ? <span>Booking as <strong>{profileSaved.firstName} {profileSaved.lastName}</strong></span> : <span className="muted">No diner profile yet</span>}<button type="button" className="link" onClick={() => setEditingProfile(v => !v)}>{editingProfile ? 'Close' : profileComplete(profileSaved) ? 'Edit' : 'Add details'}</button><button type="button" className="theme" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} aria-label="Switch theme">{theme === 'dark' ? 'Light' : 'Dark'}</button></div></div></header>
    {editingProfile && <ProfileForm value={profileSaved} onCancel={() => setEditingProfile(false)} onSave={saveProfile} />}
    <main className="feed" ref={feed}>
      {messages.map(m => <div key={m.id} className={`bubble ${m.role}`}>{m.text}</div>)}
      {thinking && <div className="bubble assistant muted">Checking…</div>}
      {results && !(job && busyStates.includes(job.state)) && <section className="results">
        {results.map(entry => <article key={entry.venue.slug} className="venue">
          <div className="venue-head"><div><h2>{entry.venue.name}</h2><p>{entry.venue.cuisine} · {entry.venue.address}, {entry.venue.neighborhood}, {entry.venue.city}</p></div><a href={`https://www.sevenrooms.com/explore/${entry.venue.slug}/reservations/create/search?date=${intent.date}&party_size=${intent.partySize}&time=${intent.timeFrom}`} target="_blank" rel="noreferrer" title="Opens the restaurant's live SevenRooms page for this date">Verify on SevenRooms</a></div>
          {entry.error && <p className="muted">Could not check this restaurant right now.</p>}
          {!entry.error && !entry.slots.length && <p className="muted">No tables in this window.</p>}
          {intent.exactTime && entry.pick ? <div className="pickrow">
            <button type="button" className={`pickbtn ${selection?.slot === entry.pick ? 'on' : ''}`} onClick={() => void pick(entry.venue, entry.pick!)}>Book {entry.pick.label}{entry.pick.time !== intent.exactTime && <small>closest to {timeLabel(intent.exactTime)}</small>}{entry.pick.area && <small>{entry.pick.area}</small>}</button>
            {entry.slots.filter(s => s.type === 'book').length > 1 && <details className="others"><summary>Other times</summary><div className="chips">{entry.slots.filter(s => s !== entry.pick).map(slot => <button key={slot.time} type="button" className={`chip ${slot.type}`} disabled={slot.type !== 'book'} title={slot.type === 'book' ? slot.area : 'Request only on SevenRooms'} onClick={() => void pick(entry.venue, slot)}>{slot.label}{slot.type === 'request' ? <small>request</small> : null}</button>)}</div></details>}
          </div> : intent.exactTime && entry.slots.length ? <p className="muted">Only request-only times near {timeLabel(intent.exactTime)}.</p> : null}
          {!intent.exactTime && <div className="chips">{entry.slots.map(slot => <button key={slot.time} type="button" className={`chip ${slot.type} ${selection?.slot === slot ? 'on' : ''}`} disabled={slot.type !== 'book'} title={slot.type === 'book' ? slot.area : 'Request only on SevenRooms'} onClick={() => void pick(entry.venue, slot)}>{slot.label}{slot.area && slot.type === 'book' ? <small>{slot.area}</small> : slot.type === 'request' ? <small>request</small> : null}</button>)}</div>}
        </article>)}
      </section>}
      {selection && intent.date && !profileComplete(contact) && <form className="confirm" onSubmit={e => { e.preventDefault(); void prepare(selection.venue, selection.slot, contact); }}>
        <h3>Who is the table for?</h3>
        <p><strong>{selection.venue.name}</strong> · {dayLabel(intent.date)} at {selection.slot.label} · party of {intent.partySize}</p>
        <ContactFields value={contact} onChange={setContact} />
        <p className="muted">Saved on this machine and used to fill the restaurant’s form. Nothing is booked until you confirm on the next step.</p>
        <div className="actions"><button type="button" className="ghost" onClick={() => setSelection(null)}>Not this one</button><button type="submit" className="primary" disabled={!profileComplete(contact)}>Continue</button></div>
      </form>}
      {job && <section className={`job ${job.state.toLowerCase()}`}>
        <h3>{job.state === 'PREPARING' ? 'Preparing your table…' : job.state === 'READY' ? 'Ready to book' : job.state === 'SUBMITTING' ? 'Booking…' : job.state === 'CONFIRMED' ? 'Reservation confirmed' : job.state === 'EXPIRED' ? 'Hold expired' : 'Booking stopped'}</h3>
        <p><strong>{job.request.venue.name}</strong> · {dayLabel(job.request.date)} at {timeLabel(job.request.time)} · party of {job.request.partySize}</p>
        {(job.state === 'PREPARING' || job.state === 'SUBMITTING') && <ol>{job.steps.map((s, i) => <li key={i} className={i === job.steps.length - 1 ? 'live' : ''}>{stepText[s.step] ?? s.step}{s.note && !['FAILED', 'READY'].includes(s.step) ? ` · ${s.note}` : ''}</li>)}{!job.steps.length && <li className="live">Starting the browser</li>}</ol>}
        {job.state === 'READY' && job.prepared && <>
          <p className="who">Form filled as <strong>{job.prepared.values?.firstName ?? job.request.contact.firstName} {job.prepared.values?.lastName ?? job.request.contact.lastName}</strong> · {job.prepared.values?.emailAddress ?? job.request.contact.email} · {job.prepared.values?.phoneNumber ?? job.request.contact.phone}</p>
          {job.prepared.policy && <p className="muted">Restaurant policy: {job.prepared.policy}</p>}
          <p className="muted">The restaurant is holding this table for {Math.floor(holdLeft / 60)}:{String(holdLeft % 60).padStart(2, '0')}. Nothing is submitted until you confirm.</p>
          <div className="actions"><button type="button" className="ghost" onClick={() => void cancel()}>Cancel</button><button type="button" className="primary" onClick={() => void confirm()}>Confirm booking</button></div>
        </>}
        {job.result && job.state !== 'READY' && <p>{job.result.message}</p>}
        {job.result?.reference && <p className="ref">Confirmation {job.result.reference}</p>}
        {job.state === 'FAILED' && job.result?.screenshot && <figure className="evidence"><img src={job.result.screenshot} alt="The restaurant's booking page at the moment Pearl stopped" /><figcaption className="muted">What Pearl saw on the restaurant's page when it stopped.{job.result.pageUrl && <> <a href={job.result.pageUrl} target="_blank" rel="noreferrer">Open the page</a></>}</figcaption></figure>}
        {job.state === 'PREPARING' && <button type="button" className="ghost" onClick={() => void cancel()}>Cancel</button>}
        {!busyStates.includes(job.state) && <button type="button" className="ghost" onClick={() => { setJob(null); if (job.state === 'CONFIRMED') setResults(null); }}>{job.state === 'CONFIRMED' ? 'Start another search' : 'Back to the times'}</button>}
      </section>}
      {error && <div className="error">{error}</div>}
    </main>
    <form className="composer" onSubmit={send}>
      <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="table for 2 in the West Village Friday, 7–9pm" autoFocus disabled={thinking} />
      <button type="submit" className="primary" disabled={thinking || !draft.trim()}>Send</button>
    </form>
  </div>;
}
function ContactFields({ value, onChange }: { value: Contact; onChange: (next: Contact) => void }) {
  return <div className="grid">
    <label>First name<input required autoComplete="given-name" value={value.firstName} onChange={e => onChange({ ...value, firstName: e.target.value })} /></label>
    <label>Last name<input required autoComplete="family-name" value={value.lastName} onChange={e => onChange({ ...value, lastName: e.target.value })} /></label>
    <label>Email<input required type="email" autoComplete="email" value={value.email} onChange={e => onChange({ ...value, email: e.target.value })} /></label>
    <label>Mobile (US)<input required type="tel" autoComplete="tel" placeholder="212 555 0100" value={value.phone} onChange={e => onChange({ ...value, phone: e.target.value })} /></label>
  </div>;
}
function ProfileForm({ value, onSave, onCancel }: { value: Contact; onSave: (next: Contact) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState<Contact>(value); const [busy, setBusy] = useState(false); const [problem, setProblem] = useState<string | null>(null);
  return <form className="confirm profile-form" onSubmit={async e => { e.preventDefault(); setBusy(true); setProblem(null); try { await onSave(draft); } catch (err) { setProblem(err instanceof Error ? err.message : 'Could not save.'); } finally { setBusy(false); } }}>
    <h3>Your details</h3>
    <p className="muted">Saved on this machine only (.local/profile.json) and used to fill the restaurant’s booking form when you confirm a table.</p>
    <ContactFields value={draft} onChange={setDraft} />
    {problem && <div className="error">{problem}</div>}
    <div className="actions"><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button type="submit" className="primary" disabled={busy || !profileComplete(draft)}>Save details</button></div>
  </form>;
}
