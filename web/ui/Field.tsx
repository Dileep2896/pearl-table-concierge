import type { InputHTMLAttributes } from 'react';
type Props = InputHTMLAttributes<HTMLInputElement> & { label: string };
export function Field({ label, className = '', ...rest }: Props) {
  return <label className={`field ${className}`}><span className="field-label">{label}</span><input {...rest} /></label>;
}
