import { useState } from 'react';
import type { Contact } from '../api';
import { profileComplete } from '../hooks/useProfile';

export function ContactFields({ value, onChange }: { value: Contact; onChange: (next: Contact) => void }) {
  return <div className="grid">
    <label>First name<input required autoComplete="given-name" value={value.firstName} onChange={e => onChange({ ...value, firstName: e.target.value })} /></label>
    <label>Last name<input required autoComplete="family-name" value={value.lastName} onChange={e => onChange({ ...value, lastName: e.target.value })} /></label>
    <label>Email<input required type="email" autoComplete="email" value={value.email} onChange={e => onChange({ ...value, email: e.target.value })} /></label>
    <label>Mobile (US)<input required type="tel" autoComplete="tel" placeholder="212 555 0100" value={value.phone} onChange={e => onChange({ ...value, phone: e.target.value })} /></label>
  </div>;
}

export function ProfileForm({ value, onSave, onCancel }: { value: Contact; onSave: (next: Contact) => Promise<unknown>; onCancel: () => void }) {
  const [draft, setDraft] = useState<Contact>(value); const [busy, setBusy] = useState(false); const [problem, setProblem] = useState<string | null>(null);
  return <form className="confirm profile-form" onSubmit={async e => { e.preventDefault(); setBusy(true); setProblem(null); try { await onSave(draft); } catch (err) { setProblem(err instanceof Error ? err.message : 'Could not save.'); } finally { setBusy(false); } }}>
    <h3>Your details</h3>
    <p className="muted">Saved on this machine only (.local/profile.json) and used to fill the restaurant’s booking form when you confirm a table.</p>
    <ContactFields value={draft} onChange={setDraft} />
    {problem && <div className="error">{problem}</div>}
    <div className="actions"><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button type="submit" className="primary" disabled={busy || !profileComplete(draft)}>Save details</button></div>
  </form>;
}
