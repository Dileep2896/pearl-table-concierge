import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, dayLabel, timeLabel, type Intent, type Message, type Slot, type Venue, type VenueAvailability } from './api';
import { useProfile, profileComplete } from './hooks/useProfile';
import { useBookingJob, busyStates } from './hooks/useBookingJob';
import { ContactFields, ProfileForm } from './components/ContactFields';
import { Results } from './components/Results';
import { JobPanel } from './components/JobPanel';
import { Bookings } from './components/Bookings';

type Selection = { venue: Venue; slot: Slot };
const welcome: Message = { id: 'welcome', role: 'assistant', text: 'Tell me where, when, and for how many. I cover New York (West Village, Greenwich Village, Flatiron, Upper West Side) and San Francisco (Union Square, Jackson Square, Nob Hill, SoMa, Mission, Lower Haight, Financial District). Give me a window like “7–9pm” and I will show every open time; name one time like “at 7” and I will pick the closest table at each restaurant, so you only choose the restaurant.' };
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
  const [editingProfile, setEditingProfile] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [ledgerVersion, setLedgerVersion] = useState(0);
  const profile = useProfile();
  const booking = useBookingJob();
  const { job } = booking;
  const feed = useRef<HTMLDivElement>(null);
  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' }); }, [messages, results, selection, job?.state]);
  useEffect(() => {
    if (!job || busyStates.includes(job.state) || job.state === 'CANCELLED') return;
    const done = job.result;
    setMessages(m => [...m, { id: `job-${job.id}-${job.state}`, role: 'assistant', text: job.state === 'CONFIRMED' ? `Booked: ${job.request.venue.name}, ${dayLabel(job.request.date)} at ${timeLabel(job.request.time)} for ${job.request.partySize}. ${done?.message ?? ''}` : `I could not complete that booking. ${done?.message ?? ''}` }]);
    if (job.state === 'CONFIRMED') setLedgerVersion(v => v + 1);
  }, [job?.state]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim(); if (!text || thinking) return;
    const next = [...messages, { id: `u-${Date.now()}`, role: 'user' as const, text }];
    setMessages(next); setDraft(''); setThinking(true); setChatError(null); setSelection(null);
    try {
      const reply = await api.chat(next, intent);
      setIntent(reply.intent); setResults(reply.results);
      setMessages(m => [...m, { id: `a-${Date.now()}`, role: 'assistant', text: reply.reply }]);
    } catch (e) { setChatError(e instanceof Error ? e.message : 'Something went wrong. Is the demo API running on port 8788?'); }
    finally { setThinking(false); }
  }
  /** Picking a time starts the browser straight away when the profile is complete; otherwise ask for details first. */
  async function pick(venue: Venue, slot: Slot) {
    setSelection({ venue, slot }); setChatError(null);
    if (profileComplete(profile.contact)) await prepare(venue, slot);
  }
  async function prepare(venue: Venue, slot: Slot) {
    if (!intent.date || !intent.partySize) return;
    if (JSON.stringify(profile.contact) !== JSON.stringify(profile.saved)) { try { await profile.save(profile.contact); } catch { /* proceed with typed details */ } }
    const started = await booking.start(venue, slot, intent.date, intent.partySize, profile.contact);
    if (started) { setSelection(null); setMessages(m => [...m, { id: `b-${started.id}`, role: 'user', text: `${venue.name} at ${slot.label}.` }]); }
  }
  const error = chatError ?? booking.error;

  return <div className="shell">
    <header className="top"><div><span className="eyebrow">Pearl</span><h1>Table concierge</h1></div><div className="side"><div className="facts">{intent.partySize && <span>{intent.partySize} guests</span>}{intent.date && <span>{dayLabel(intent.date)}</span>}{intent.exactTime ? <span>around {timeLabel(intent.exactTime)}</span> : intent.timeFrom && intent.timeTo && <span>{timeLabel(intent.timeFrom)} – {timeLabel(intent.timeTo)}</span>}{intent.neighborhood && <span>{intent.neighborhood}</span>}</div>
      <div className="profile">{profile.complete ? <span>Booking as <strong>{profile.saved.firstName} {profile.saved.lastName}</strong></span> : <span className="muted">No diner profile yet</span>}<button type="button" className="link" onClick={() => setEditingProfile(v => !v)}>{editingProfile ? 'Close' : profile.complete ? 'Edit' : 'Add details'}</button><button type="button" className="theme" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} aria-label="Switch theme">{theme === 'dark' ? 'Light' : 'Dark'}</button></div></div></header>
    {editingProfile && <ProfileForm value={profile.saved} onCancel={() => setEditingProfile(false)} onSave={async next => { await profile.save(next); setEditingProfile(false); }} />}
    <Bookings version={ledgerVersion} />
    <main className="feed" ref={feed}>
      {messages.map(m => <div key={m.id} className={`bubble ${m.role}`}>{m.text}</div>)}
      {thinking && <div className="bubble assistant muted">Checking…</div>}
      {results && !(job && busyStates.includes(job.state)) && <Results results={results} intent={intent} selected={selection?.slot} onPick={(venue, slot) => void pick(venue, slot)} />}
      {selection && intent.date && !profileComplete(profile.contact) && <form className="confirm" onSubmit={e => { e.preventDefault(); void prepare(selection.venue, selection.slot); }}>
        <h3>Who is the table for?</h3>
        <p><strong>{selection.venue.name}</strong> · {dayLabel(intent.date)} at {selection.slot.label} · party of {intent.partySize}</p>
        <ContactFields value={profile.contact} onChange={profile.setContact} />
        <p className="muted">Saved on this machine and used to fill the restaurant’s form. Nothing is booked until you confirm on the next step.</p>
        <div className="actions"><button type="button" className="ghost" onClick={() => setSelection(null)}>Not this one</button><button type="submit" className="primary" disabled={!profileComplete(profile.contact)}>Continue</button></div>
      </form>}
      {job && <JobPanel job={job} holdLeft={booking.holdLeft} onConfirm={() => void booking.confirm()} onCancel={() => void booking.cancel()} onDismiss={() => { booking.setJob(null); if (job.state === 'CONFIRMED') setResults(null); }} />}
      {error && <div className="error">{error}</div>}
    </main>
    <form className="composer" onSubmit={send}>
      <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="table for 2 in the West Village Friday, 7–9pm" autoFocus disabled={thinking} />
      <button type="submit" className="primary" disabled={thinking || !draft.trim()}>Send</button>
    </form>
  </div>;
}
