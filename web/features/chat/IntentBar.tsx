import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../../store/store';
import { shortDay, timeLabel } from '../../lib/format';
import { Icon } from '../../ui/Icon';
/** Quiet brass chips echoing what the concierge understood so far. */
export function IntentBar() {
  const i = useStore(s => s.chat.intent);
  const chips = [
    i.partySize && { k: 'p', icon: 'guests' as const, t: `${i.partySize} ${i.partySize === 1 ? 'guest' : 'guests'}` },
    i.neighborhood && { k: 'n', icon: 'pin' as const, t: i.neighborhood },
    i.date && { k: 'd', icon: 'clock' as const, t: shortDay(i.date) },
    (i.exactTime || i.timeFrom) && { k: 't', icon: 'clock' as const, t: i.exactTime ? timeLabel(i.exactTime) : `${timeLabel(i.timeFrom!)}–${timeLabel(i.timeTo!)}` },
  ].filter(Boolean) as { k: string; icon: 'guests' | 'pin' | 'clock'; t: string }[];
  if (!chips.length) return null;
  return <div className="intent-bar"><AnimatePresence>{chips.map(c => <motion.span key={c.k} layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className="intent-chip"><Icon name={c.icon} size={13} />{c.t}</motion.span>)}</AnimatePresence></div>;
}
