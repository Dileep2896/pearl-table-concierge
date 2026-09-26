export const timeLabel = (time: string) => { const [h, m] = time.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
export const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
export const shortDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;
import type { Contact } from './api';
export const emptyContact: Contact = { firstName: '', lastName: '', email: '', phone: '' };
export const profileComplete = (p: Contact) => Boolean(p.firstName && p.lastName && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email) && p.phone.replace(/\D/g, '').length >= 10);

export const sevenRoomsUrl = (slug: string, date: string, partySize: number, time: string) => `https://www.sevenrooms.com/explore/${slug}/reservations/create/search?date=${date}&party_size=${partySize}&time=${encodeURIComponent(time)}`;
