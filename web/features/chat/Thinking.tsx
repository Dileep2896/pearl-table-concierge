import { motion } from 'motion/react';
/** Three brass embers breathing while the concierge checks tables. */
export function Thinking() {
  return <motion.div className="bubble assistant thinking" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
    <span className="ember-row">{[0, 1, 2].map(i => <motion.span key={i} className="ember" animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }} transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }} />)}</span>
    <span className="muted">Checking tonight’s tables</span>
  </motion.div>;
}
