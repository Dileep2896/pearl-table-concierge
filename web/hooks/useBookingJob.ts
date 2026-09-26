import { useCallback, useEffect, useState } from 'react';
import { api, type BookingJob, type Contact, type Slot, type Venue } from '../api';

export const busyStates = ['PREPARING', 'READY', 'SUBMITTING'];

/**
 * Drives one booking job: start, poll while the browser works, confirm, cancel. Polling backs off
 * from 1 s to 3 s while a hold is waiting, and gives up loudly if the API disappears.
 */
export function useBookingJob() {
  const [job, setJob] = useState<BookingJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!job || !busyStates.includes(job.state)) return;
    let misses = 0; let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (stopped) return;
      setTick(t => t + 1);
      try { const { job: next } = await api.job(job.id); misses = 0; setJob(next); }
      catch (e) {
        misses += 1;
        if (misses >= 8) { setJob(current => current && busyStates.includes(current.state) ? { ...current, state: 'FAILED', result: { status: 'FAILED', code: 'API_UNREACHABLE', message: `Lost contact with the demo API (${e instanceof Error ? e.message : 'no response'}). If you had already confirmed, check your email. Run npm run demo again if it is not running.` } } : current); return; }
      }
      timer = setTimeout(poll, job.state === 'READY' ? 3000 : 700);
    };
    timer = setTimeout(poll, 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [job?.id, job?.state]);

  const start = useCallback(async (venue: Venue, slot: Slot, date: string, partySize: number, contact: Contact) => {
    setError(null);
    try { const { job } = await api.prepare({ venue: venue.slug, date, time: slot.time, partySize, contact }); setJob(job); return job; }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start. Is the demo API running on port 8788?'); return null; }
  }, []);
  const confirm = useCallback(async () => { if (!job) return; setError(null); try { const { job: next } = await api.confirm(job.id); setJob(next); } catch (e) { setError(e instanceof Error ? e.message : 'Could not confirm.'); } }, [job?.id]);
  const cancel = useCallback(async () => { if (!job) return; try { await api.cancel(job.id); } catch { /* already gone */ } setJob(null); }, [job?.id]);
  const holdLeft = job?.prepared ? Math.max(0, Math.round((Date.parse(job.prepared.holdExpiresAt) - Date.now()) / 1000)) : 0;
  const verifyLeft = job?.verification && !job.verification.passedAt ? Math.max(0, Math.round((Date.parse(job.verification.expiresAt) - Date.now()) / 1000)) : 0;
  const needsHuman = Boolean(job?.state === 'SUBMITTING' && job.verification && !job.verification.passedAt);
  // A short chime and a title change the moment the checkbox appears, in case the page is not in focus.
  useEffect(() => {
    if (!needsHuman) { document.title = 'Pearl · Table concierge'; return; }
    document.title = '✅ Tick the box · Pearl';
    try { const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = 0.08; o.start(); o.frequency.setValueAtTime(1175, ctx.currentTime + 0.15); o.stop(ctx.currentTime + 0.3); setTimeout(() => void ctx.close(), 500); } catch { /* audio blocked */ }
  }, [needsHuman]);
  void tick;
  return { job, setJob, error, setError, start, confirm, cancel, holdLeft, verifyLeft, needsHuman };
}
