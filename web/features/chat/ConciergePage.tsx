import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../../store/store';
import { Pearl } from '../../ui/Pearl';
import { Conversation } from './Conversation';
import { Composer } from './Composer';
import { IntentBar } from './IntentBar';
import { Results } from '../venues/Results';
import { ContactFields } from '../profile/ProfileForm';
import { Button } from '../../ui/Button';
import { profileComplete, dayLabel } from '../../lib/format';

const examples = ['Two in the West Village, Friday at 8', 'Dinner for four in SoMa this Saturday, 7–9', 'A table for two on Nob Hill tomorrow at 7'];

export function ConciergePage() {
  const messages = useStore(s => s.chat.messages); const results = useStore(s => s.chat.results);
  const intent = useStore(s => s.chat.intent);
  const setDraft = useStore(s => s.setDraft); const send = useStore(s => s.send);
  const profile = useStore(s => s.profile); const setContact = useStore(s => s.setContact);
  const selection = useStore(s => s.selection); const clearSelection = useStore(s => s.clearSelection);
  const prepare = useStore(s => s.prepare);
  const started = messages.length > 1 || Boolean(results);

  if (!started) return <div className="intro-stage">
    <motion.div className="intro-inner" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
      <Pearl size={72} />
      <h1 className="intro-title">Good evening.<br />What are you in the mood for?</h1>
      <p className="intro-sub">Real tables at New York and San Francisco restaurants. Tell me a window like <em>“Friday 7 to 9”</em> to see every opening, or one time like <em>“Friday at 8”</em> and I’ll hold the closest table so you only choose the room.</p>
      <Composer large />
      <div className="intro-examples">{examples.map(x => <button key={x} className="example" onClick={() => { setDraft(x); void send(x); }}>{x}</button>)}</div>
    </motion.div>
  </div>;

  return <div className="stage">
    <section className="rail">
      <Conversation />
      <IntentBar />
      <Composer />
    </section>
    <section className="board">
      <Results />
      <AnimatePresence>{selection && !profile.complete && <motion.form className="card contact-gate" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onSubmit={e => { e.preventDefault(); void prepare(selection.venue, selection.slot); }}>
        <h3>Who is the table for?</h3>
        <p className="muted">{selection.venue.name} · {selection.slot.label}{intent.date ? ` · ${dayLabel(intent.date)}` : ''}</p>
        <ContactFields value={profile.contact} onChange={setContact} />
        <div className="row-end"><Button variant="ghost" type="button" onClick={clearSelection}>Not this one</Button><Button type="submit" disabled={!profileComplete(profile.contact)}>Continue</Button></div>
      </motion.form>}</AnimatePresence>
    </section>
  </div>;
}
