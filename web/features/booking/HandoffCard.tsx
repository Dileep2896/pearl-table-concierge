import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../../store/store';
import { dayLabel, timeLabel, sevenRoomsUrl } from '../../lib/format';
import { overlayFade, panelPop } from '../../lib/motion';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';

/** Handoff mode: the diner finishes on SevenRooms in their own browser, then tells us if it worked. */
export function HandoffCard() {
  const handoff = useStore(s => s.handoff);
  const intent = useStore(s => s.chat.intent);
  const confirm = useStore(s => s.confirmHandoff); const dismiss = useStore(s => s.dismissHandoff);
  const openAgain = useStore(s => s.openHandoff);
  return <AnimatePresence>{handoff && <>
    <motion.div className="scrim" variants={overlayFade} initial="hidden" animate="show" exit="exit" onClick={dismiss} />
    <div className="job-overlay"><motion.section className="job-card" variants={panelPop} initial="hidden" animate="show" exit="exit" role="dialog" aria-modal="true">
      <button className="job-close" aria-label="Close" onClick={dismiss}><Icon name="x" size={18} /></button>
      <header className="job-head"><div><p className="job-eyebrow">{handoff.venue.city} · {handoff.venue.neighborhood}</p><h2>Finish on SevenRooms</h2></div></header>
      <p className="job-line"><strong>{handoff.venue.name}</strong> · {intent.date ? dayLabel(intent.date) : ''} at {handoff.slot.label} · {intent.partySize} guests</p>
      <ol className="handoff-steps">
        <li>The restaurant’s booking page opened in a new tab.</li>
        <li>Pick <strong>{handoff.slot.label}</strong>, add your details, and confirm there.</li>
        <li>Come back and let me know how it went.</li>
      </ol>
      <p className="muted quiet">Didn’t open? <a href={intent.date && intent.partySize ? sevenRoomsUrl(handoff.venue.slug, intent.date, intent.partySize, handoff.slot.time) : '#'} target="_blank" rel="noreferrer" onClick={() => openAgain(handoff.venue, handoff.slot)}>Open it again</a>.</p>
      <div className="row-end"><Button variant="ghost" onClick={dismiss}>Didn’t book</Button><Button onClick={() => void confirm()}><Icon name="check" size={16} /> I booked it</Button></div>
    </motion.section></div>
  </>}</AnimatePresence>;
}
