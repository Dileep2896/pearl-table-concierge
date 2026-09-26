import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from './store/store';
import { ThemeToggle } from './ui/ThemeToggle';
import { Conversation } from './features/chat/Conversation';
import { Composer } from './features/chat/Composer';
import { IntentBar } from './features/chat/IntentBar';
import { Results } from './features/venues/Results';
import { ProfileBadge } from './features/profile/ProfileBadge';
import { ProfileForm } from './features/profile/ProfileForm';
import { ContactFields } from './features/profile/ProfileForm';
import { BookingsList } from './features/bookings/BookingsList';
import { JobCard } from './features/booking/JobCard';
import { Button } from './ui/Button';
import { profileComplete } from './lib/format';
import { dayLabel } from './lib/format';

export function App() {
  const theme = useStore(s => s.theme);
  const loadProfile = useStore(s => s.loadProfile); const loadBookings = useStore(s => s.loadBookings);
  const saveProfile = useStore(s => s.saveProfile);
  const profile = useStore(s => s.profile); const setContact = useStore(s => s.setContact);
  const selection = useStore(s => s.selection); const clearSelection = useStore(s => s.clearSelection);
  const prepare = useStore(s => s.prepare);
  const results = useStore(s => s.chat.results); const error = useStore(s => s.error);
  const [editing, setEditing] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { void loadProfile(); void loadBookings(); }, [loadProfile, loadBookings]);

  return <div className="app">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">P</span><div><span className="brand-name">Pearl</span><span className="brand-sub">Table concierge</span></div></div>
      <div className="topbar-right"><ProfileBadge onEdit={() => setEditing(v => !v)} editing={editing} /><ThemeToggle /></div>
    </header>

    <AnimatePresence>{editing && <motion.div className="profile-drawer" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      <ProfileForm value={profile.saved} onCancel={() => setEditing(false)} onSave={async c => { await saveProfile(c); setEditing(false); }} />
    </motion.div>}</AnimatePresence>

    <main className="stage">
      <section className="rail">
        <Conversation />
        <IntentBar />
        <Composer />
        <BookingsList />
      </section>
      <section className="board">
        {!results && <Welcome />}
        <Results />
        <AnimatePresence>{selection && !profile.complete && <motion.form className="card contact-gate" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onSubmit={e => { e.preventDefault(); void prepare(selection.venue, selection.slot); }}>
          <h3>Who is the table for?</h3>
          <p className="muted">{selection.venue.name} · {selection.slot.label}{useStore.getState().chat.intent.date ? ` · ${dayLabel(useStore.getState().chat.intent.date!)}` : ''}</p>
          <ContactFields value={profile.contact} onChange={setContact} />
          <div className="row-end"><Button variant="ghost" type="button" onClick={clearSelection}>Not this one</Button><Button type="submit" disabled={!profileComplete(profile.contact)}>Continue</Button></div>
        </motion.form>}</AnimatePresence>
      </section>
    </main>

    <AnimatePresence>{error && <motion.div className="toast bad" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} onClick={() => useStore.getState().setError(null)}>{error}</motion.div>}</AnimatePresence>
    <JobCard />
  </div>;
}

function Welcome() {
  return <motion.div className="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
    <motion.div className="welcome-mark" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
      <svg width="120" height="120" viewBox="0 0 120 120" fill="none"><circle cx="60" cy="60" r="46" stroke="var(--brass)" strokeWidth="1" opacity="0.4" /><circle cx="60" cy="60" r="30" stroke="var(--brass)" strokeWidth="1" opacity="0.6" /><circle cx="60" cy="60" r="9" fill="var(--brass)" opacity="0.8" /></svg>
    </motion.div>
    <h1 className="welcome-title">An evening,<br />arranged.</h1>
    <p className="welcome-sub">Tell the concierge what you have in mind. Real tables at New York and San Francisco restaurants, held and reserved once you confirm.</p>
    <div className="welcome-hints"><span>“Two in the West Village, Friday at 8”</span><span>“Dinner for four in SoMa this Saturday, 7–9”</span></div>
  </motion.div>;
}
