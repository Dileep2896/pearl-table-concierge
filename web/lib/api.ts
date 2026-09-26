export type Venue = { slug: string; name: string; city: string; neighborhood: string; timezone: string; address: string; cuisine: string; website?: string };
export type Slot = { venue: string; time: string; label: string; timeIso: string; area: string; type: 'book' | 'request' };
export type Intent = { neighborhood?: string; unsupportedLocation?: string; exactTime?: string; date?: string; timeFrom?: string; timeTo?: string; partySize?: number };
export type Message = { id: string; role: 'user' | 'assistant'; text: string };
export type VenueAvailability = { venue: Venue; slots: Slot[]; pick?: Slot; error?: string };
export type ChatResponse = { reply: string; intent: Intent; ready: boolean; source: 'codex' | 'parser'; results: VenueAvailability[] | null };
export type Contact = { firstName: string; lastName: string; email: string; phone: string };
export type JobState = 'PREPARING' | 'READY' | 'SUBMITTING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
export type BookingStep = { step: string; note?: string; at: string };
export type JobResult = { status: string; code: string; message: string; reference?: string; policy?: string; pageUrl?: string; hasEvidence?: boolean };
export type BookingJob = {
  id: string; state: JobState; createdAt?: string; updatedAt?: string; steps: BookingStep[];
  request: { venue: Venue; date: string; time: string; partySize: number; contact: Contact };
  prepared?: { policy?: string; values?: Record<string, string>; holdExpiresAt: string };
  verification?: { requestedAt: string; expiresAt: string; passedAt?: string };
  result?: JobResult;
};
export type LedgerEntry = { id: string; confirmedAt: string; venue: string; venueName: string; city: string; date: string; time: string; partySize: number; reference?: string; pageUrl?: string };

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError((body as { message?: string }).message || `Request failed (${response.status})`, response.status);
  return body as T;
}
const post = (url: string, data?: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });

export const api = {
  profile: () => fetch('/api/profile').then(r => json<{ profile: Contact; complete: boolean }>(r)),
  saveProfile: (profile: Contact) => fetch('/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(profile) }).then(r => json<{ profile: Contact; complete: boolean }>(r)),
  chat: (messages: Message[], intent: Intent) => post('/api/chat', { messages: messages.map(({ role, text }) => ({ role, text })), intent }).then(r => json<ChatResponse>(r)),
  prepare: (body: { venue: string; date: string; time: string; partySize: number; contact: Contact }) => post('/api/book', body).then(r => json<{ job: BookingJob }>(r)),
  confirm: (id: string) => post(`/api/book/${id}/confirm`).then(r => json<{ job: BookingJob }>(r)),
  cancel: (id: string) => fetch(`/api/book/${id}`, { method: 'DELETE' }).then(r => json<{ job: BookingJob }>(r)),
  job: (id: string) => fetch(`/api/book/${id}`).then(r => json<{ job: BookingJob }>(r)),
  bookings: () => fetch('/api/bookings').then(r => json<{ bookings: LedgerEntry[] }>(r)),
  venues: () => fetch('/api/venues').then(r => json<{ venues: Venue[] }>(r)),
};
