import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../../store/store';
import { dayLabel } from '../../lib/format';
import { useModalA11y } from '../../lib/useModal';
import { overlayFade } from '../../lib/motion';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';

/**
 * Handoff: the diner finishes on the restaurant's own SevenRooms page, then tells us if it worked. The page is
 * opened in a new tab rather than embedded — consumer reservation sites block being framed, so an iframe is blank.
 */
export function HandoffCard() {
  const handoff = useStore(s => s.handoff);
  const confirm = useStore(s => s.confirmHandoff); const dismiss = useStore(s => s.dismissHandoff);
  const [asking, setAsking] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  useModalA11y(dialogRef, { active: Boolean(handoff), onEscape: dismiss });
  return <AnimatePresence onExitComplete={() => setAsking(false)}>{handoff && <>
    <motion.div className="scrim" variants={overlayFade} initial="hidden" animate="show" exit="exit" onClick={dismiss} />
    <div className="browser-overlay"><motion.section ref={dialogRef} tabIndex={-1} className="browser" initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16 }} transition={{ type: 'spring', stiffness: 420, damping: 34 }} role="dialog" aria-modal="true" aria-label={`Book ${handoff.venue.name} on SevenRooms`}>
      <header className="browser-bar">
        <div className="browser-title"><Icon name="lock" size={13} /><span>sevenrooms.com</span></div>
        <div className="browser-meta">{handoff.venue.name} · {handoff.slot.label}</div>
        <button className="browser-x" onClick={dismiss} aria-label="Close"><Icon name="x" size={16} /></button>
      </header>
      <div className="handoff-open">
        <Icon name="lock" size={30} />
        <h3>Finish on SevenRooms</h3>
        <p className="muted">Opens the restaurant’s own page in a new tab. Pick {handoff.slot.label} on {dayLabel(new URL(handoff.url).searchParams.get('date') ?? handoff.slot.timeIso.slice(0, 10))}, add your details and confirm there, then come back here.</p>
        <a href={handoff.url} target="_blank" rel="noreferrer" className="btn btn-primary handoff-open-btn"><Icon name="arrow" size={16} /> Open SevenRooms</a>
      </div>
      <footer className="browser-foot">
        {asking ? <>
          <span className="muted quiet">Did you get the table at {handoff.slot.label}?</span>
          <div className="browser-foot-btns"><Button variant="ghost" onClick={dismiss}>Not yet</Button><Button onClick={() => void confirm()}><Icon name="check" size={15} /> Yes, save it</Button></div>
        </> : <>
          <span className="muted quiet">Booked it in the other tab? Save it to your reservations here.</span>
          <Button onClick={() => setAsking(true)}>I’m done</Button>
        </>}
      </footer>
    </motion.section></div>
  </>}</AnimatePresence>;
}
