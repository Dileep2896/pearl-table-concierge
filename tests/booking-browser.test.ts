import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { SevenRoomsBooker, extractReference } from '../server/booking-browser';
import { BrowserPool } from '../server/browser-pool';

// A tiny stand-in for the SevenRooms widget: search page -> Select modal -> checkout -> confirmation.
const searchPage = (time: string) => `<!doctype html><body><h1>Fixture Bistro</h1>
<button type="button" data-test="reservation-timeslot-button-${time}-Indoor Dining" data-time="${time}" onclick="document.getElementById('modal').hidden=false">${time}<br>Indoor Dining</button>
<div id="modal" hidden><p>Indoor Dining · 2 hours</p><button type="button" onclick="fetch('/api-yoa/dining/hold/add',{method:'POST',body:'{}'}).then(()=>location.href='/explore/fixture/reservations/create/checkout/?date=2026-10-02&party_size=2&time=19:00')">Select</button></div></body>`;
// Stripe utility frames are present on every real checkout, even when no card is required.
const hiddenStripe = `<iframe src="https://js.stripe.com/v3/controller-x" style="width:0;height:0;border:0"></iframe><iframe src="https://js.stripe.com/v3/m-outer-x" style="width:430px;height:1px;border:0"></iframe>`;
const visibleStripe = `<iframe src="https://js.stripe.com/v3/elements-inner-card-x" title="Secure payment input frame" style="width:356px;height:425px"></iframe><input name="postalCode" placeholder="Postal Code">`;
const policyDialog = (text: string) => `<button type="button" data-test="agreement-term-info-button" onclick="document.getElementById('dlg').style.display='block'">i</button><div id="dlg" role="dialog" style="display:none">Cancellation Policy ${text}</div><script>document.addEventListener('keydown',e=>{if(e.key==='Escape')document.getElementById('dlg').style.display='none'})</script>`;
const checkoutPage = `<!doctype html><body><h2>Complete your reservation.</h2>${hiddenStripe}${policyDialog('Please cancel at least 2 hours ahead so we can offer the table to another guest.')}
<input name="firstName" autocomplete="given-name"><input name="lastName" autocomplete="family-name"><input name="emailAddress" type="email"><input name="phoneNumber" type="tel">
<input type="checkbox" id="agreedToBookingPolicy" name="agreedToBookingPolicy"><label for="agreedToBookingPolicy">I agree to the Cancellation Policy</label>
<button type="button" data-test="checkout-button-complete" onclick="if(!document.getElementById('agreedToBookingPolicy').checked){document.body.insertAdjacentHTML('beforeend','<p>Something went wrong</p>');return}
fetch('/api-yoa/booking/dining/widget/abc/book',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({first_name:document.querySelector('[name=firstName]').value,phone:document.querySelector('[name=phoneNumber]').value})}).then(r=>r.json()).then(j=>{document.body.innerHTML='<h1>Reservation confirmed</h1><p>Confirmation #: '+j.data.reference_code+'</p>'})">Submit</button></body>`;

async function fixtureBrowser(record: { posts: { url: string; body: string | null }[] }, options: { reference?: string; slot?: string; checkout?: string } = {}) {
  const browser = await chromium.launch();
  const original = browser.newContext.bind(browser);
  browser.newContext = async contextOptions => {
    const context = await original(contextOptions);
    await context.route('https://www.sevenrooms.com/**', route => {
      const request = route.request(); const url = new URL(request.url());
      if (request.method() === 'POST') record.posts.push({ url: url.pathname, body: request.postData() });
      if (url.pathname.endsWith('/hold/add')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 200, data: { hold_id: 'h1' } }) });
      if (url.pathname.endsWith('/book')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 200, data: { reference_code: options.reference ?? 'ZX4Q9K' } }) });
      if (url.pathname.includes('/checkout')) return route.fulfill({ contentType: 'text/html', body: options.checkout ?? checkoutPage });
      return route.fulfill({ contentType: 'text/html', body: searchPage(options.slot ?? '7:00 PM') });
    });
    return context;
  };
  return browser;
}
/** A pool over the fixture browser: the booker gets a context per booking, exactly as in production. */
const pool = (record: { posts: { url: string; body: string | null }[] }, options: { reference?: string; slot?: string; checkout?: string } = {}) => new BrowserPool({ launch: () => fixtureBrowser(record, options) });
const request = { venue: 'fixture', date: '2026-10-02', time: '19:00', partySize: 2, contact: { firstName: 'Test', lastName: 'Diner', email: 'diner@example.org', phone: '+1 212 555 0100' } };

describe('SevenRoomsBooker', () => {
  it('selects the time, fills the guest form, accepts the policy and submits once', async () => {
    const record = { posts: [] as { url: string; body: string | null }[] }; const steps: string[] = [];
    const booker = new SevenRoomsBooker({ contexts: pool(record), onStep: step => steps.push(step) });
    const result = await booker.book(request);
    expect(result.status, result.message).toBe('CONFIRMED'); expect(result.reference).toBe('ZX4Q9K');
    expect(result.policy).toMatch(/cancel at least 2 hours/);
    expect(steps).toEqual(['OPENING', 'SELECTING_TIME', 'HOLDING', 'FILLING', 'READY', 'SUBMITTING', 'CONFIRMED']);
    expect(record.posts.map(p => p.url)).toEqual(['/api-yoa/dining/hold/add', '/api-yoa/booking/dining/widget/abc/book']);
    expect(JSON.parse(record.posts[1].body!)).toEqual({ first_name: 'Test', phone: '2125550100' });
  });
  it('stops when the requested time is not on the page', async () => {
    const record = { posts: [] as { url: string; body: string | null }[] };
    const booker = new SevenRoomsBooker({ contexts: pool(record, { slot: '8:00 PM' }) });
    const result = await booker.book(request);
    expect(result.status).toBe('FAILED'); expect(result.code).toBe('SLOT_GONE'); expect(record.posts).toHaveLength(0);
  });
  it('prepare fills the form and holds without pressing Submit; confirm presses it once', async () => {
    const record = { posts: [] as { url: string; body: string | null }[] }; const steps: string[] = [];
    const booker = new SevenRoomsBooker({ contexts: pool(record), onStep: step => steps.push(step) });
    const prepared = await booker.prepare(request);
    expect(prepared.status).toBe('READY'); expect(prepared.holdSeconds).toBeGreaterThan(0);
    expect(prepared.values).toMatchObject({ firstName: 'Test', emailAddress: 'diner@example.org', phoneNumber: '2125550100' });
    expect(prepared.policy).toMatch(/cancel at least 2 hours/);
    expect(record.posts.map(p => p.url)).toEqual(['/api-yoa/dining/hold/add']); expect(booker.ready).toBe(true);
    const result = await booker.confirm();
    expect(result.status).toBe('CONFIRMED'); expect(result.reference).toBe('ZX4Q9K');
    expect(record.posts.map(p => p.url)).toEqual(['/api-yoa/dining/hold/add', '/api-yoa/booking/dining/widget/abc/book']);
    expect(steps).toEqual(['OPENING', 'SELECTING_TIME', 'HOLDING', 'FILLING', 'READY', 'SUBMITTING', 'CONFIRMED']); expect(booker.ready).toBe(false);
  });
  it('close releases a prepared session and confirm then refuses', async () => {
    const record = { posts: [] as { url: string; body: string | null }[] };
    const booker = new SevenRoomsBooker({ contexts: pool(record) });
    expect((await booker.prepare(request)).status).toBe('READY');
    await booker.close();
    expect((await booker.confirm()).code).toBe('NOT_PREPARED'); expect(record.posts).toHaveLength(1);
  });
  it('stops before filling when the checkout renders a card frame', async () => {
    const record = { posts: [] as { url: string; body: string | null }[] };
    const booker = new SevenRoomsBooker({ contexts: pool(record, { checkout: checkoutPage.replace(hiddenStripe, hiddenStripe + visibleStripe) }) });
    const result = await booker.book(request);
    expect(result.status).toBe('FAILED'); expect(result.code).toBe('PAYMENT_REQUIRED'); expect(record.posts.map(p => p.url)).toEqual(['/api-yoa/dining/hold/add']);
  });
  it('refuses venues whose cancellation policy charges a fee unless told otherwise', async () => {
    const record = { posts: [] as { url: string; body: string | null }[] };
    const feePage = checkoutPage.replace('Please cancel at least 2 hours ahead so we can offer the table to another guest.', 'No shows or late cancellations are subject to a fee of $55 per person applied to the credit card on file.');
    const strict = await new SevenRoomsBooker({ contexts: pool(record, { checkout: feePage }) }).book(request);
    expect(strict.status).toBe('FAILED'); expect(strict.code).toBe('CANCELLATION_FEE'); expect(strict.policy).toMatch(/\$55/); expect(strict.screenshot?.byteLength).toBeGreaterThan(100);
    expect(record.posts.some(p => p.url.endsWith('/book'))).toBe(false);
    const relaxed = await new SevenRoomsBooker({ contexts: pool(record, { checkout: feePage }), requireFreeCancellation: false }).book(request);
    expect(relaxed.status).toBe('CONFIRMED');
  });
  it('rejects bad contact details before opening a browser', async () => {
    const booker = new SevenRoomsBooker({ contexts: { context: async () => { throw new Error('should not open a context'); } } });
    await expect(booker.book({ ...request, contact: { ...request.contact, email: 'nope' } })).rejects.toThrow();
  });
  it('extracts references from responses or page text', () => {
    expect(extractReference({ data: { reservation: { reference_code: 'ABC123' } } })).toBe('ABC123');
    expect(extractReference(undefined, 'Thanks! Confirmation number: QW3RTY. See you soon.')).toBe('QW3RTY');
    expect(extractReference(undefined, 'Nothing here')).toBeUndefined();
  });
});
