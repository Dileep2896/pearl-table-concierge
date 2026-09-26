import { useStore } from '../../store/store';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
export function Composer({ large = false }: { large?: boolean }) {
  const draft = useStore(s => s.draft); const setDraft = useStore(s => s.setDraft);
  const send = useStore(s => s.send); const thinking = useStore(s => s.chat.thinking);
  return <form className={`composer ${large ? 'composer-lg' : ''}`} onSubmit={e => { e.preventDefault(); void send(draft); }}>
    <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="A table for two in the West Village, Friday at 8…" autoFocus disabled={thinking} aria-label="Message the concierge" />
    <Button type="submit" disabled={thinking || !draft.trim()} aria-label="Send"><Icon name="send" size={18} /></Button>
  </form>;
}
