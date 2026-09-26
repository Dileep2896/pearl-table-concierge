export type Venue = { slug: string; name: string; city: string; neighborhood: string; timezone: string; address: string; cuisine: string; website?: string };
export type Slot = { venue: string; time: string; label: string; timeIso: string; area: string; type: 'book' | 'request' };
export type Intent = { neighborhood?: string; unsupportedLocation?: string; exactTime?: string; date?: string; timeFrom?: string; timeTo?: string; partySize?: number };
export type Message = { id: string; role: 'user' | 'assistant'; text: string };
export type VenueAvailability = { venue: Venue; slots: Slot[]; pick?: Slot; error?: string };
export type ChatResponse = { reply: string; intent: Intent; ready: boolean; source: 'codex' | 'parser'; results: VenueAvailability[] | null };
export type Contact = { firstName: string; lastName: string; email: string; phone: string };
export type JobState = 'PREPARING' | 'READY' | 'SUBMITTING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
export type BookingJob = { id: string; state: JobState; steps: { step: string; note?: string; at: string }[]; request: { venue: Venue; date: string; time: string; partySize: number; contact: Contact }; prepared?: { policy?: string; values?: Record<string, string>; holdExpiresAt: string }; result?: { status: string; code: string; message: string; reference?: string; policy?: string; pageUrl?: string; screenshot?: string } };

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { message?: string }).message || `Request failed (${response.status})`);
  return body as T;
}
export type Profile = Contact;
export const api = {
  profile: () => fetch('/api/profile').then(r => json<{ profile: Profile; complete: boolean }>(r)),
  saveProfile: (profile: Profile) => fetch('/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(profile) }).then(r => json<{ profile: Profile; complete: boolean }>(r)),
  chat: (messages: Message[], intent: Intent) => fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: messages.map(({ role, text }) => ({ role, text })), intent }) }).then(r => json<ChatResponse>(r)),
  prepare: (body: { venue: string; date: string; time: string; partySize: number; contact: Contact }) => fetch('/api/book', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => json<{ job: BookingJob }>(r)),
  confirm: (id: string) => fetch(`/api/book/${id}/confirm`, { method: 'POST' }).then(r => json<{ job: BookingJob }>(r)),
  cancel: (id: string) => fetch(`/api/book/${id}`, { method: 'DELETE' }).then(r => json<{ job: BookingJob }>(r)),
  job: (id: string) => fetch(`/api/book/${id}`).then(r => json<{ job: BookingJob }>(r)),
};
export const timeLabel = (time: string) => { const [h, m] = time.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
export const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
