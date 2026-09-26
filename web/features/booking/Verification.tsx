import { motion } from 'motion/react';
import type { BookingJob } from '../../lib/api';
import { clock } from '../../lib/format';
import { Icon } from '../../ui/Icon';
/** The one human step: the restaurant asks for a "not a robot" tick and Tavola waits. */
export function Verification({ job, secondsLeft }: { job: BookingJob; secondsLeft: number }) {
  if (!job.verification) return null;
  if (job.verification.passedAt) return <motion.p className="notice ok" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Icon name="check" size={16} /> Verified. Placing your reservation…</motion.p>;
  return <motion.div className="verify-call" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
    <motion.span className="verify-glow" animate={{ opacity: [0.4, 0.9, 0.4] }} transition={{ duration: 1.4, repeat: Infinity }} />
    <div className="verify-body">
      <Icon name="shield" size={22} />
      <div><strong>One tick from you.</strong><p>The restaurant asked to confirm you’re human. In the browser window that opened, tick “I’m not a robot”. I’ll place the reservation the moment it clears.</p></div>
      <span className="verify-count tnum">{clock(secondsLeft)}</span>
    </div>
  </motion.div>;
}
