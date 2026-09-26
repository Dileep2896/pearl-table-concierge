import { motion } from 'motion/react';
import type { BookingJob } from '../../lib/api';
const order = ['OPENING', 'SELECTING_TIME', 'HOLDING', 'FILLING', 'READY', 'SUBMITTING', 'CONFIRMED'] as const;
const labels: Record<string, string> = { OPENING: 'Opening the restaurant', SELECTING_TIME: 'Choosing your time', HOLDING: 'Holding the table', FILLING: 'Filling in your details', READY: 'Ready for you', SUBMITTING: 'Placing the reservation', CONFIRMED: 'Confirmed' };
/** A vertical brass rail that lights each step as the browser reaches it. */
export function Stepper({ job }: { job: BookingJob }) {
  const done = new Set(job.steps.map(s => s.step));
  const current = job.steps.at(-1)?.step;
  const activeIndex = current ? order.indexOf(current as typeof order[number]) : 0;
  return <ol className="stepper">
    {order.slice(0, job.state === 'CONFIRMED' ? order.length : order.indexOf('SUBMITTING') + 1).map((step, i) => {
      const state = done.has(step) && step !== current ? 'done' : step === current ? 'active' : i < activeIndex ? 'done' : 'todo';
      return <li key={step} className={`step ${state}`}>
        <span className="step-dot">{state === 'done' ? <motion.svg width="12" height="12" viewBox="0 0 24 24" initial={{ scale: 0 }} animate={{ scale: 1 }}><path d="M5 12.5 10 17l9-10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></motion.svg> : state === 'active' ? <motion.span className="step-pulse" animate={{ scale: [1, 1.5, 1], opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} /> : null}</span>
        <span className="step-label">{labels[step]}</span>
      </li>;
    })}
  </ol>;
}
