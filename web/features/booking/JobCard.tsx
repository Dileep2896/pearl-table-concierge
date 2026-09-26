import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../../store/store';
import { dayLabel, timeLabel } from '../../lib/format';
import { panelPop, overlayFade } from '../../lib/motion';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { HoldRing } from '../../ui/HoldRing';
import { Stepper } from './Stepper';
import { Verification } from './Verification';

const titles: Record<string, string> = { PREPARING: 'Preparing your table', READY: 'Ready to reserve', SUBMITTING: 'Placing your reservation', CONFIRMED: 'Table reserved', EXPIRED: 'The hold expired', FAILED: 'Reservation stopped', CANCELLED: 'Cancelled' };
const retryable = ['CAPTCHA_UNSOLVED', 'HOLD_EXPIRED', 'SLOT_GONE', 'NO_CONFIRMATION', 'TIMEOUT', 'API_UNREACHABLE'];
function useNow(active: boolean) { const [, set] = useState(0); useEffect(() => { if (!active) return; const t = setInterval(() => set(n => n + 1), 1000); return () => clearInterval(t); }, [active]); }

export function JobCard() {
  const job = useStore(s => s.job);
  const confirm = useStore(s => s.confirmBooking); const cancel = useStore(s => s.cancelBooking);
  const dismiss = useStore(s => s.dismissJob); const retry = useStore(s => s.retryJob);
  const needsHuman = Boolean(job?.state === 'SUBMITTING' && job.verification && !job.verification.passedAt);
  useNow(Boolean(job && (job.state === 'READY' || needsHuman)));
  useEffect(() => {
    if (!needsHuman) { document.title = 'Pearl — Table concierge'; return; }
    document.title = '● Tick the box — Pearl';
    try { const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.type = 'sine'; o.frequency.value = 784; g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5); o.start(); o.frequency.setValueAtTime(1046, ctx.currentTime + 0.12); o.stop(ctx.currentTime + 0.5); setTimeout(() => void ctx.close(), 700); } catch { /* audio blocked */ }
  }, [needsHuman]);

  return <AnimatePresence>{job && <>
    <motion.div className="scrim" variants={overlayFade} initial="hidden" animate="show" exit="exit" onClick={() => { if (!['SUBMITTING'].includes(job.state)) (job.state === 'READY' ? cancel : dismiss)(); }} />
    <div className="job-overlay"><motion.section className={`job-card state-${job.state.toLowerCase()}`} variants={panelPop} initial="hidden" animate="show" exit="exit" role="dialog" aria-modal="true" aria-label="Booking status">
      <header className="job-head">
        <div><p className="job-eyebrow">{job.request.venue.city} · {job.request.venue.neighborhood}</p><h2>{titles[job.state] ?? job.state}</h2></div>
        {job.state === 'READY' && job.prepared && <HoldRing seconds={Math.max(0, Math.round((Date.parse(job.prepared.holdExpiresAt) - Date.now()) / 1000))} total={280} label="held" />}
        {job.state === 'CONFIRMED' && <ConfirmSeal />}
      </header>
      <p className="job-line"><strong>{job.request.venue.name}</strong> · {dayLabel(job.request.date)} at {timeLabel(job.request.time)} · {job.request.partySize} guests</p>

      {(job.state === 'PREPARING' || job.state === 'SUBMITTING') && <Stepper job={job} />}
      {needsHuman ? <Verification job={job} secondsLeft={job.verification ? Math.max(0, Math.round((Date.parse(job.verification.expiresAt) - Date.now()) / 1000)) : 0} /> : job.verification?.passedAt && job.state === 'SUBMITTING' && <Verification job={job} secondsLeft={0} />}

      {job.state === 'READY' && job.prepared && <div className="ready">
        <p className="who">Filling in as <strong>{job.prepared.values?.firstName ?? job.request.contact.firstName} {job.prepared.values?.lastName ?? job.request.contact.lastName}</strong> · {job.prepared.values?.emailAddress ?? job.request.contact.email}</p>
        {job.prepared.policy && <p className="muted policy">“{job.prepared.policy}”</p>}
        <p className="muted quiet">The table is held for you. Nothing is placed until you confirm.</p>
        <div className="row-end"><Button variant="ghost" onClick={() => void cancel()}>Release</Button><Button onClick={() => void confirm()}><Icon name="check" size={16} /> Confirm reservation</Button></div>
      </div>}

      {job.result && job.state !== 'READY' && <p className={`job-message ${job.state === 'CONFIRMED' ? 'ok' : job.state === 'FAILED' || job.state === 'EXPIRED' ? 'bad' : ''}`}>{job.result.message}</p>}
      {job.result?.reference && <p className="reference"><span className="reference-label">Reservation</span><span className="reference-code">{job.result.reference}</span></p>}
      {job.state === 'FAILED' && job.result?.hasEvidence && <figure className="evidence"><img src={`/api/book/${job.id}/evidence.png`} alt="The restaurant’s page when Pearl stopped" /><figcaption className="muted quiet">What the restaurant’s page showed.{job.result.pageUrl && <> <a href={job.result.pageUrl} target="_blank" rel="noreferrer">Open it</a></>}</figcaption></figure>}

      {job.state === 'PREPARING' && <div className="row-end"><Button variant="ghost" onClick={() => void cancel()}>Cancel</Button></div>}
      {!['PREPARING', 'READY', 'SUBMITTING'].includes(job.state) && <div className="row-end">{retryable.includes(job.result?.code ?? '') && <Button onClick={retry}>Try this time again</Button>}<Button variant="ghost" onClick={dismiss}>{job.state === 'CONFIRMED' ? 'Done' : 'Back to tables'}</Button></div>}
    </motion.section></div>
  </>}</AnimatePresence>;
}

function ConfirmSeal() {
  return <motion.svg className="seal" width="56" height="56" viewBox="0 0 56 56" initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
    <circle cx="28" cy="28" r="25" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
    <motion.path d="M18 28.5 25 35 39 20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.15 }} />
  </motion.svg>;
}
