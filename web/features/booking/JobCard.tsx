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
// Stops the server browser can't get past — offer the diner the device-side finish instead.
const handoffable = ['PAYMENT_REQUIRED', 'LOGIN_REQUIRED', 'CAPTCHA_REJECTED', 'CAPTCHA_UNSOLVED', 'WIDGET_REJECTED', 'NO_CONFIRMATION'];
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
      {job.state !== 'SUBMITTING' && <button className="job-close" aria-label="Close" onClick={() => (job.state === 'READY' || job.state === 'PREPARING' ? cancel() : dismiss())}><Icon name="x" size={18} /></button>}
      <header className="job-head">
        <div><p className="job-eyebrow">{job.request.venue.city} · {job.request.venue.neighborhood}</p><h2>{titles[job.state] ?? job.state}</h2></div>
        {job.state === 'READY' && job.prepared && <HoldRing seconds={Math.max(0, Math.round((Date.parse(job.prepared.holdExpiresAt) - Date.now()) / 1000))} total={280} label="held" />}
        {job.state === 'CONFIRMED' && <ConfirmSeal />}
      </header>
      <p className="job-line"><strong>{job.request.venue.name}</strong> · {dayLabel(job.request.date)} at {timeLabel(job.request.time)} · {job.request.partySize} guests</p>

      {(job.state === 'PREPARING' || job.state === 'SUBMITTING') && <Stepper job={job} />}
      {needsHuman && job.verification?.liveViewUrl ? <LiveVerification url={job.verification.liveViewUrl} secondsLeft={job.verification ? Math.max(0, Math.round((Date.parse(job.verification.expiresAt) - Date.now()) / 1000)) : 0} /> : needsHuman ? <Verification job={job} secondsLeft={job.verification ? Math.max(0, Math.round((Date.parse(job.verification.expiresAt) - Date.now()) / 1000)) : 0} /> : job.verification?.passedAt && job.state === 'SUBMITTING' && <Verification job={job} secondsLeft={0} />}

      {job.state === 'READY' && job.prepared && <div className="ready">
        <p className="who">Filling in as <strong>{job.prepared.values?.firstName ?? job.request.contact.firstName} {job.prepared.values?.lastName ?? job.request.contact.lastName}</strong> · {job.prepared.values?.emailAddress ?? job.request.contact.email}</p>
        {job.prepared.feeWarning ? <div className="notice warn"><Icon name="warn" size={16} /><span><strong>Cancellation fee.</strong> {job.prepared.feeWarning}</span></div> : job.prepared.policy && <p className="muted policy">“{job.prepared.policy}”</p>}
        <p className="muted quiet">The table is held for you. Nothing is placed until you confirm.{job.prepared.feeWarning ? ' By confirming you accept the restaurant’s fee policy.' : ''}</p>
        <div className="row-end"><Button variant="ghost" onClick={() => void cancel()}>Release</Button><Button onClick={() => void confirm()}><Icon name="check" size={16} /> {job.prepared.feeWarning ? 'Accept & confirm' : 'Confirm reservation'}</Button></div>
      </div>}

      {job.result && job.state !== 'READY' && <p className={`job-message ${job.state === 'CONFIRMED' ? 'ok' : job.state === 'FAILED' || job.state === 'EXPIRED' ? 'bad' : ''}`}>{job.result.message}</p>}
      {job.state === 'FAILED' && job.result?.policy && job.result.code === 'CANCELLATION_FEE' && <blockquote className="policy-quote">{job.result.policy}</blockquote>}
      {job.result?.reference && <p className="reference"><span className="reference-label">Reservation</span><span className="reference-code">{job.result.reference}</span></p>}

      {job.state === 'PREPARING' && <div className="row-end"><Button variant="ghost" onClick={() => void cancel()}>Cancel</Button></div>}
      {job.state === 'FAILED' && handoffable.includes(job.result?.code ?? '') && <p className="muted quiet finish-hint">Pearl can’t finish this one for you. You can complete it yourself on the restaurant’s page.</p>}
      {!['PREPARING', 'READY', 'SUBMITTING'].includes(job.state) && <div className="row-end">
        {job.state === 'FAILED' && handoffable.includes(job.result?.code ?? '') && <Button onClick={() => useStore.getState().openHandoff(job.request.venue, { venue: job.request.venue.slug, time: job.request.time, label: timeLabel(job.request.time), timeIso: `${job.request.date} ${job.request.time}:00`, area: '', type: 'book' }, { date: job.request.date, partySize: job.request.partySize })}>Finish on SevenRooms</Button>}
        {retryable.includes(job.result?.code ?? '') && <Button variant="ghost" onClick={retry}>Try again</Button>}
        <Button variant="ghost" onClick={dismiss}>{job.state === 'CONFIRMED' ? 'Done' : 'Back to tables'}</Button>
      </div>}
    </motion.section></div>
  </>}</AnimatePresence>;
}

function LiveVerification({ url, secondsLeft }: { url: string; secondsLeft: number }) {
  return <div className="live-verify">
    <p className="notice warn"><Icon name="shield" size={16} /><span><strong>One tick from you.</strong> The restaurant asked to confirm you’re human. Tick “I’m not a robot” in the window below — Pearl is filling everything else. <span className="tnum">{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</span></span></p>
    <iframe className="live-frame" src={url} title="Complete the verification" allow="clipboard-write" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
  </div>;
}
function ConfirmSeal() {
  return <motion.svg className="seal" width="56" height="56" viewBox="0 0 56 56" initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
    <circle cx="28" cy="28" r="25" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
    <motion.path d="M18 28.5 25 35 39 20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.15 }} />
  </motion.svg>;
}
