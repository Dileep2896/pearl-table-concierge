import type { Contact } from '../../lib/api';
import { Field } from '../../ui/Field';

export function ContactFields({ value, onChange }: { value: Contact; onChange: (c: Contact) => void }) {
  return <div className="grid2">
    <Field label="First name" autoComplete="given-name" value={value.firstName} onChange={e => onChange({ ...value, firstName: e.target.value })} />
    <Field label="Last name" autoComplete="family-name" value={value.lastName} onChange={e => onChange({ ...value, lastName: e.target.value })} />
    <Field label="Email" type="email" autoComplete="email" value={value.email} onChange={e => onChange({ ...value, email: e.target.value })} />
    <Field label="Mobile (US)" type="tel" autoComplete="tel" placeholder="212 555 0100" value={value.phone} onChange={e => onChange({ ...value, phone: e.target.value })} />
  </div>;
}
