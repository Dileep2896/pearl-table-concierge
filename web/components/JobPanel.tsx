import { dayLabel, timeLabel, type BookingJob } from '../api';
import { busyStates } from '../hooks/useBookingJob';

const stepText: Record<string, string> = { OPENING: 'Opening the restaurant’s booking page', SELECTING_TIME: 'Selecting your time', HOLDING: 'Holding the table for you', FILLING: 'Filling in your contact details', READY: 'Ready for your confirmation', SUBMITTING: 'Submitting the reservation', CONFIRMED: 'Confirmed', FAILED: 'Stopped' };
const titles: Record<string, string> = { PREPARING: 'Preparing your table…', READY: 'Ready to book', SUBMITTING: 'Booking…', CONFIRMED: 'Reservation confirmed', EXPIRED: 'Hold expired', FAILED: 'Booking stopped', CANCELLED: 'Cancelled' };

type Props = { job: BookingJob; holdLeft: number; onConfirm: () => void; onCancel: () => void; onDismiss: () => void };

/** The booking's live status: steps while the browser works, the confirm step while the table is held, then the outcome. */
export function JobPanel({ job, holdLeft, onConfirm, onCancel, onDismiss }: Props) {
  const busy = busyStates.includes(job.state);
  return <section className={`job ${job.state.toLowerCase()}`}>
    <h3>{titles[job.state] ?? job.state}</h3>
    <p><strong>{job.request.venue.name}</strong> · {dayLabel(job.request.date)} at {timeLabel(job.request.time)} · party of {job.request.partySize}</p>
    {(job.state === 'PREPARING' || job.state === 'SUBMITTING') && <ol>{job.steps.map((s, i) => <li key={i} className={i === job.steps.length - 1 ? 'live' : ''}>{stepText[s.step] ?? s.step}{s.note && !['FAILED', 'READY'].includes(s.step) ? ` · ${s.note}` : ''}</li>)}{!job.steps.length && <li className="live">Starting the browser</li>}</ol>}
    {job.state === 'READY' && job.prepared && <>
      <p className="who">Form filled as <strong>{job.prepared.values?.firstName ?? job.request.contact.firstName} {job.prepared.values?.lastName ?? job.request.contact.lastName}</strong> · {job.prepared.values?.emailAddress ?? job.request.contact.email} · {job.prepared.values?.phoneNumber ?? job.request.contact.phone}</p>
      {job.prepared.policy && <p className="muted">Restaurant policy: {job.prepared.policy}</p>}
      <p className="muted">The restaurant is holding this table for {Math.floor(holdLeft / 60)}:{String(holdLeft % 60).padStart(2, '0')}. Nothing is submitted until you confirm.</p>
      <div className="actions"><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button type="button" className="primary" onClick={onConfirm}>Confirm booking</button></div>
    </>}
    {job.result && job.state !== 'READY' && <p>{job.result.message}</p>}
    {job.result?.reference && <p className="ref">Confirmation {job.result.reference}</p>}
    {job.state === 'FAILED' && job.result?.hasEvidence && <figure className="evidence"><img src={`/api/book/${job.id}/evidence.png`} alt="The restaurant's booking page at the moment Pearl stopped" /><figcaption className="muted">What Pearl saw on the restaurant's page when it stopped.{job.result.pageUrl && <> <a href={job.result.pageUrl} target="_blank" rel="noreferrer">Open the page</a></>}</figcaption></figure>}
    {job.state === 'PREPARING' && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}
    {!busy && <button type="button" className="ghost" onClick={onDismiss}>{job.state === 'CONFIRMED' ? 'Start another search' : 'Back to the times'}</button>}
  </section>;
}
