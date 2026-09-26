import { create } from 'zustand';
import { api, ApiError, type BookingJob, type Contact, type Intent, type Message, type VenueAvailability, type Slot, type Venue, type LedgerEntry } from '../lib/api';
import { emptyContact, profileComplete } from '../lib/format';

type Theme = 'dark' | 'light';
type Chat = { messages: Message[]; intent: Intent; results: VenueAvailability[] | null; thinking: boolean; source: 'codex' | 'parser' | null };
const busy = (s: BookingJob['state']) => s === 'PREPARING' || s === 'READY' || s === 'SUBMITTING';
const welcome: Message = { id: 'welcome', role: 'assistant', text: 'Good evening. Tell me where, when, and for how many, and I will find a table. Give me a window like “Friday 7 to 9” to see every opening, or one time like “Friday at 8” and I will hold the closest table at each restaurant so you only choose the room.' };

export type Store = {
  theme: Theme; toggleTheme: () => void;
  chat: Chat;
  draft: string; setDraft: (v: string) => void;
  error: string | null; setError: (v: string | null) => void;
  send: (text: string) => Promise<void>;

  profile: { contact: Contact; saved: Contact; complete: boolean; loaded: boolean };
  setContact: (c: Contact) => void;
  loadProfile: () => Promise<void>;
  saveProfile: (c: Contact) => Promise<void>;

  selection: { venue: Venue; slot: Slot } | null;
  select: (venue: Venue, slot: Slot) => void;
  clearSelection: () => void;

  job: BookingJob | null;
  poll: { timer?: ReturnType<typeof setTimeout>; misses: number };
  prepare: (venue: Venue, slot: Slot) => Promise<void>;
  confirmBooking: () => Promise<void>;
  cancelBooking: () => Promise<void>;
  dismissJob: () => void;
  retryJob: () => void;
  _startPolling: () => void;
  _stopPolling: () => void;

  bookings: LedgerEntry[];
  loadBookings: () => Promise<void>;
};

function initialTheme(): Theme {
  try { const s = localStorage.getItem('pearl-theme'); if (s === 'light' || s === 'dark') return s; } catch { /* private mode */ }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export const useStore = create<Store>((set, get) => ({
  theme: initialTheme(),
  toggleTheme: () => set(s => { const theme = s.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('pearl-theme', theme); } catch { /* ignore */ } document.documentElement.dataset.theme = theme; return { theme }; }),

  chat: { messages: [welcome], intent: {}, results: null, thinking: false, source: null },
  draft: '', setDraft: v => set({ draft: v }),
  error: null, setError: v => set({ error: v }),
  async send(text) {
    const trimmed = text.trim(); if (!trimmed || get().chat.thinking) return;
    const messages = [...get().chat.messages, { id: `u-${Date.now()}`, role: 'user' as const, text: trimmed }];
    set(s => ({ chat: { ...s.chat, messages, thinking: true }, draft: '', error: null, selection: null }));
    try {
      const reply = await api.chat(messages, get().chat.intent);
      set(s => ({ chat: { messages: [...messages, { id: `a-${Date.now()}`, role: 'assistant', text: reply.reply }], intent: reply.intent, results: reply.results, thinking: false, source: reply.source } }));
    } catch (e) {
      set(s => ({ chat: { ...s.chat, thinking: false }, error: e instanceof ApiError ? e.message : 'The concierge is offline. Is the API running on port 8788?' }));
    }
  },

  profile: { contact: emptyContact, saved: emptyContact, complete: false, loaded: false },
  setContact: c => set(s => ({ profile: { ...s.profile, contact: c } })),
  async loadProfile() {
    try { const { profile } = await api.profile(); set({ profile: { contact: profile, saved: profile, complete: profileComplete(profile), loaded: true } }); }
    catch { set(s => ({ profile: { ...s.profile, loaded: true } })); }
  },
  async saveProfile(c) {
    const { profile } = await api.saveProfile(c);
    set({ profile: { contact: profile, saved: profile, complete: profileComplete(profile), loaded: true } });
  },

  selection: null,
  select(venue, slot) { set({ selection: { venue, slot }, error: null }); if (get().profile.complete) void get().prepare(venue, slot); },
  clearSelection() { set({ selection: null }); },

  job: null,
  poll: { misses: 0 },
  async prepare(venue, slot) {
    const { intent } = get().chat; if (!intent.date || !intent.partySize) return;
    const p = get().profile;
    if (JSON.stringify(p.contact) !== JSON.stringify(p.saved)) { try { await get().saveProfile(p.contact); } catch { /* proceed with typed details */ } }
    try {
      const { job } = await api.prepare({ venue: venue.slug, date: intent.date, time: slot.time, partySize: intent.partySize, contact: get().profile.contact });
      set(s => ({ job, selection: null, chat: { ...s.chat, messages: [...s.chat.messages, { id: `b-${job.id}`, role: 'user', text: `${venue.name} at ${slot.label}.` }] } }));
      get()._startPolling();
    } catch (e) { set({ error: e instanceof ApiError ? e.message : 'Could not reach the API.' }); }
  },
  async confirmBooking() {
    const job = get().job; if (!job) return;
    set({ error: null });
    try { const { job: next } = await api.confirm(job.id); set({ job: next }); get()._startPolling(); }
    catch (e) { set({ error: e instanceof ApiError ? e.message : 'Could not confirm.' }); }
  },
  async cancelBooking() {
    const job = get().job; get()._stopPolling();
    if (job) { try { await api.cancel(job.id); } catch { /* already gone */ } }
    set({ job: null });
  },
  dismissJob() { const s = get(); const confirmed = s.job?.state === 'CONFIRMED'; s._stopPolling(); set(st => ({ job: null, chat: confirmed ? { ...st.chat, results: null } : st.chat })); },
  retryJob() { const job = get().job; if (!job) return; const r = job.request; get()._stopPolling(); set({ job: null }); void get().prepare(r.venue, { venue: r.venue.slug, time: r.time, label: r.time, timeIso: `${r.date} ${r.time}:00`, area: '', type: 'book' }); },

  _stopPolling() { const t = get().poll.timer; if (t) clearTimeout(t); set({ poll: { misses: 0 } }); },
  _startPolling() {
    get()._stopPolling();
    const tick = async () => {
      const job = get().job; if (!job || !busy(job.state)) return;
      try {
        const { job: next } = await api.job(job.id);
        set({ job: next, poll: { ...get().poll, misses: 0 } });
        if (next.state === 'CONFIRMED') void get().loadBookings();
        if (busy(next.state)) schedule(next.state);
      } catch {
        const misses = get().poll.misses + 1; set({ poll: { ...get().poll, misses } });
        if (misses >= 8) { set(s => ({ job: s.job && busy(s.job.state) ? { ...s.job, state: 'FAILED', result: { status: 'FAILED', code: 'API_UNREACHABLE', message: 'Lost contact with the concierge service. If you had already confirmed, check your phone for the confirmation. Restart the app if it is not running.' } } : s.job })); return; }
        schedule(get().job?.state ?? 'PREPARING');
      }
    };
    const schedule = (state: BookingJob['state']) => set({ poll: { ...get().poll, timer: setTimeout(tick, state === 'READY' ? 2500 : 700) } });
    schedule(get().job?.state ?? 'PREPARING');
  },

  bookings: [],
  async loadBookings() { try { const { bookings } = await api.bookings(); set({ bookings }); } catch { /* ignore */ } },
}));

export const jobIsBusy = busy;
