import { useState } from 'react';
import type { Contact } from '../../lib/api';
import { profileComplete } from '../../lib/format';
import { Field } from '../../ui/Field';
import { Button } from '../../ui/Button';
export function ContactFields({ value, onChange }: { value: Contact; onChange: (c: Contact) => void }) {
  return <div className="grid2">
    <Field label="First name" autoComplete="given-name" value={value.firstName} onChange={e => onChange({ ...value, firstName: e.target.value })} />
    <Field label="Last name" autoComplete="family-name" value={value.lastName} onChange={e => onChange({ ...value, lastName: e.target.value })} />
    <Field label="Email" type="email" autoComplete="email" value={value.email} onChange={e => onChange({ ...value, email: e.target.value })} />
    <Field label="Mobile (US)" type="tel" autoComplete="tel" placeholder="212 555 0100" value={value.phone} onChange={e => onChange({ ...value, phone: e.target.value })} />
  </div>;
}
export function ProfileForm({ value, onSave, onCancel }: { value: Contact; onSave: (c: Contact) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState<Contact>(value); const [busy, setBusy] = useState(false); const [problem, setProblem] = useState<string | null>(null);
  return <form className="card profile-form" onSubmit={async e => { e.preventDefault(); setBusy(true); setProblem(null); try { await onSave(draft); } catch (err) { setProblem(err instanceof Error ? err.message : 'Could not save.'); } finally { setBusy(false); } }}>
    <h3>Your details</h3>
    <p className="muted">Kept on this device only and used to fill the restaurant’s form when you confirm. Nothing is booked yet.</p>
    <ContactFields value={draft} onChange={setDraft} />
    {problem && <div className="notice bad">{problem}</div>}
    <div className="row-end"><Button variant="ghost" type="button" onClick={onCancel}>Cancel</Button><Button type="submit" disabled={busy || !profileComplete(draft)}>{busy ? 'Saving…' : 'Save details'}</Button></div>
  </form>;
}
