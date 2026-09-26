import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../../store/store';
import type { Intent } from '../../lib/api';

type Reply = { label: string; send: string; hint?: string };

/** The next thing the concierge needs, and one-tap answers for it. Order mirrors the server's readiness check. */
function nextField(intent: Intent, areas: { city: string; neighborhoods: string[] }[]): { title: string; replies: Reply[] } | null {
  if (intent.unsupportedLocation || !intent.neighborhood) {
    const replies: Reply[] = [];
    for (const a of areas) { replies.push({ label: a.city, send: a.city }); for (const n of a.neighborhoods) replies.push({ label: n, send: n, hint: a.city }); }
    return replies.length ? { title: intent.unsupportedLocation ? 'I cover these areas' : 'Which area?', replies } : null;
  }
  if (!intent.date) return { title: 'Which day?', replies: dateReplies() };
  if (!intent.exactTime && !intent.timeFrom) return { title: 'What time?', replies: timeReplies() };
  if (!intent.partySize) return { title: 'How many guests?', replies: Array.from({ length: 8 }, (_, i) => ({ label: String(i + 1), send: `for ${i + 1} ${i === 0 ? 'guest' : 'guests'}` })) };
  return null;
}
function dateReplies(): Reply[] {
  const now = new Date();
  const hour = now.getHours();
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long' });
  const days: Reply[] = [{ label: hour < 21 ? 'Tonight' : 'Tomorrow', send: hour < 21 ? 'tonight' : 'tomorrow' }, { label: 'Tomorrow', send: 'tomorrow' }];
  const seen = new Set(days.map(d => d.send));
  for (let i = 2; i <= 8 && days.length < 6; i++) { const d = new Date(now); d.setDate(now.getDate() + i); const s = fmt(d).toLowerCase(); if (!seen.has(s)) { seen.add(s); days.push({ label: fmt(d), send: fmt(d) }); } }
  return days;
}
function timeReplies(): Reply[] {
  return ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'].map(t => { const [h, m] = t.split(':').map(Number); return { label: `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`, send: `at ${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}pm` }; });
}

export function QuickReplies() {
  const intent = useStore(s => s.chat.intent); const areas = useStore(s => s.areas);
  const thinking = useStore(s => s.chat.thinking); const messages = useStore(s => s.chat.messages);
  const results = useStore(s => s.chat.results); const send = useStore(s => s.send);
  if (thinking || results || messages.length <= 1) return null;
  const field = nextField(intent, areas);
  if (!field) return null;
  return <motion.div className="quick" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
    <span className="quick-title">{field.title}</span>
    <div className="quick-chips"><AnimatePresence>
      {field.replies.map(r => <motion.button key={r.label + r.send} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} whileTap={{ scale: 0.95 }} className="quick-chip" onClick={() => void send(r.send)}>{r.label}{r.hint && <small>{r.hint}</small>}</motion.button>)}
    </AnimatePresence></div>
  </motion.div>;
}
