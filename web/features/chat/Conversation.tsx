import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../../store/store';
import { Thinking } from './Thinking';
import { spring } from '../../lib/motion';
export function Conversation() {
  const messages = useStore(s => s.chat.messages); const thinking = useStore(s => s.chat.thinking);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length, thinking]);
  return <div className="conversation">
    <AnimatePresence initial={false}>
      {messages.map(m => <motion.div key={m.id} layout initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring} className={`bubble ${m.role}`}>{m.text}</motion.div>)}
    </AnimatePresence>
    {thinking && <Thinking />}
    <div ref={end} />
  </div>;
}
