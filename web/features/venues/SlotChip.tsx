import { motion } from 'motion/react';
import type { Slot } from '../../lib/api';
export function SlotChip({ slot, selected, onPick }: { slot: Slot; selected: boolean; onPick: (s: Slot) => void }) {
  const bookable = slot.type === 'book';
  return <motion.button whileTap={bookable ? { scale: 0.95 } : undefined} className={`chip ${slot.type} ${selected ? 'on' : ''}`} disabled={!bookable} title={bookable ? slot.area : 'By request only'} onClick={() => onPick(slot)}>
    {slot.label}{bookable && slot.area ? <small>{slot.area}</small> : !bookable ? <small>request</small> : null}
  </motion.button>;
}
