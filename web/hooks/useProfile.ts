import { useCallback, useEffect, useState } from 'react';
import { api, type Contact } from '../api';

export const emptyContact: Contact = { firstName: '', lastName: '', email: '', phone: '' };
export const profileComplete = (p: Contact) => Boolean(p.firstName && p.lastName && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email) && p.phone.replace(/\D/g, '').length >= 10);

/** The locally stored diner profile: loaded once, saved explicitly. `contact` is the working copy. */
export function useProfile() {
  const [contact, setContact] = useState<Contact>(emptyContact);
  const [saved, setSaved] = useState<Contact>(emptyContact);
  useEffect(() => { api.profile().then(({ profile }) => { setContact(profile); setSaved(profile); }).catch(() => {}); }, []);
  const save = useCallback(async (next: Contact) => { const { profile } = await api.saveProfile(next); setContact(profile); setSaved(profile); return profile; }, []);
  return { contact, setContact, saved, save, complete: profileComplete(saved) };
}
