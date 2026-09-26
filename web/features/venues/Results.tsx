import { motion } from 'motion/react';
import { useStore } from '../../store/store';
import { VenueCard } from './VenueCard';
import { Shimmer } from '../../ui/Shimmer';
import { stagger } from '../../lib/motion';
export function Results() {
  const results = useStore(s => s.chat.results); const thinking = useStore(s => s.chat.thinking);
  const intent = useStore(s => s.chat.intent); const selection = useStore(s => s.selection);
  const select = useStore(s => s.select);
  if (thinking && !results) return <div className="results">{Array.from({ length: 3 }).map((_, i) => <Shimmer key={i} />)}</div>;
  if (!results) return null;
  return <motion.div className="results" variants={stagger(0.02, 0.06)} initial="hidden" animate="show">
    {results.map(entry => <VenueCard key={entry.venue.slug} entry={entry} intent={intent} selected={selection?.slot} onPick={select} />)}
  </motion.div>;
}
