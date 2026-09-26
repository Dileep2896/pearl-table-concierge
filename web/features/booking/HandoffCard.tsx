import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../../store/store';
import { dayLabel } from '../../lib/format';
import { overlayFade } from '../../lib/motion';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';

/** In-app browser: the diner finishes on the restaurant's own page, embedded, then tells us if it worked. */
export function HandoffCard() {
  const handoff = useStore(s => s.handoff);
  const confirm = useStore(s => s.confirmHandoff); const dismiss = useStore(s => s.dismissHandoff);
  const [asking, setAsking] = useState(false);
  return <AnimatePresence onExitComplete={() => setAsking(false)}>{handoff && <>
    <motion.div className="scrim" variants={overlayFade} initial="hidden" animate="show" exit="exit" onClick={dismiss} />
    <div className="browser-overlay"><motion.section className="browser" initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16 }} transition={{ type: 'spring', stiffness: 420, damping: 34 }} role="dialog" aria-modal="true">
      <header className="browser-bar">
        <div className="browser-title"><Icon name="lock" size={13} /><span>sevenrooms.com</span></div>
        <div className="browser-meta">{handoff.venue.name} · {handoff.slot.label}</div>
        <div className="browser-actions">
          <a href={handoff.url} target="_blank" rel="noreferrer" className="browser-pop" title="Open in a new tab"><Icon name="arrow" size={16} /></a>
          <button className="browser-x" onClick={dismiss} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
      </header>
      <iframe className="browser-frame" src={handoff.url} title={`Book ${handoff.venue.name} on SevenRooms`} allow="payment; publickey-credentials-get" />
      <footer className="browser-foot">
        {asking ? <>
          <span className="muted quiet">Did you get the table at {handoff.slot.label}?</span>
          <div className="browser-foot-btns"><Button variant="ghost" onClick={dismiss}>Not yet</Button><Button onClick={() => void confirm()}><Icon name="check" size={15} /> Yes, save it</Button></div>
        </> : <>
          <span className="muted quiet">Pick {handoff.slot.label}{handoff.venue.city ? `` : ''}, add your details and confirm above. {dayLabel(new URL(handoff.url).searchParams.get('date')!)}.</span>
          <Button onClick={() => setAsking(true)}>I’m done</Button>
        </>}
      </footer>
    </motion.section></div>
  </>}</AnimatePresence>;
}
