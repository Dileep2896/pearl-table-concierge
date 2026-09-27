import type { Intent } from '../server/chat';

/**
 * A labelled set for the understanding layer: natural-language messages → the intent Tavola should extract.
 * Fixed `NOW` (Wed 30 Sep 2026) makes relative dates deterministic: Thu tomorrow = 10-01, next Fri = 10-02,
 * Sat = 10-03. Graded against the deterministic parser (parseIntent), so `npm run eval` costs nothing and runs
 * in CI. Each case checks only the fields in `expect`; unlisted fields are ignored.
 */
export const NOW = new Date('2026-09-30T15:00:00');

export type EvalCase = { id: string; message: string; previous?: Intent; expect: Partial<Intent>; tags: string[] };

export const cases: EvalCase[] = [
  // Neighborhood + alias resolution
  { id: 'nbhd-village-alias', message: 'somewhere in the village', expect: { neighborhood: 'West Village' }, tags: ['neighborhood'] },
  { id: 'nbhd-sf-alias', message: 'a table in SF please', expect: { neighborhood: 'San Francisco' }, tags: ['neighborhood'] },
  { id: 'nbhd-nyc-alias', message: 'anywhere in NYC', expect: { neighborhood: 'New York' }, tags: ['neighborhood'] },
  { id: 'nbhd-northbeach', message: 'dinner in north beach', expect: { neighborhood: 'Jackson Square' }, tags: ['neighborhood'] },
  { id: 'nbhd-fidi', message: 'something in fidi', expect: { neighborhood: 'Financial District' }, tags: ['neighborhood'] },
  { id: 'nbhd-beats-city', message: 'union square in SF', expect: { neighborhood: 'Union Square' }, tags: ['neighborhood'] },

  // Party size — digits and spelled-out
  { id: 'party-digit', message: 'a table for 2', expect: { partySize: 2 }, tags: ['party'] },
  { id: 'party-spelled-four', message: 'dinner for four', expect: { partySize: 4 }, tags: ['party'] },
  { id: 'party-of-us', message: '6 of us', expect: { partySize: 6 }, tags: ['party'] },
  { id: 'party-party-of', message: 'party of three', expect: { partySize: 3 }, tags: ['party'] },

  // Dates — absolute and relative to NOW
  { id: 'date-absolute', message: 'reservation on October 2', expect: { date: '2026-10-02' }, tags: ['date'] },
  { id: 'date-friday', message: 'friday night', expect: { date: '2026-10-02' }, tags: ['date'] },
  { id: 'date-tomorrow', message: 'tomorrow evening', expect: { date: '2026-10-01' }, tags: ['date'] },
  { id: 'date-saturday', message: 'this saturday', expect: { date: '2026-10-03' }, tags: ['date'] },

  // Times — single time (exactTime + derived window) and explicit windows
  { id: 'time-at-7', message: 'book us in at 7', expect: { exactTime: '19:00', timeFrom: '18:30', timeTo: '20:30' }, tags: ['time'] },
  { id: 'time-around-8pm', message: 'around 8pm', expect: { exactTime: '20:00' }, tags: ['time'] },
  { id: 'time-window-dash', message: 'sometime 7-9', expect: { timeFrom: '19:00', timeTo: '21:00' }, tags: ['time'] },
  { id: 'time-window-between', message: 'between 8 and 10', expect: { timeFrom: '20:00', timeTo: '22:00' }, tags: ['time'] },
  { id: 'time-lunch', message: 'lunch at 12:30pm', expect: { exactTime: '12:30' }, tags: ['time'] },

  // Places the demo does not cover
  { id: 'unsupported-boston', message: 'a table in Boston', expect: { unsupportedLocation: 'Boston', neighborhood: undefined }, tags: ['unsupported'] },
  { id: 'unsupported-brooklyn', message: 'dinner in brooklyn', expect: { unsupportedLocation: 'Brooklyn' }, tags: ['unsupported'] },
  { id: 'unsupported-misspelled', message: 'a table in Fermont on friday', expect: { unsupportedLocation: 'Fermont' }, tags: ['unsupported'] },

  // Full requests — several fields from one sentence
  { id: 'full-wv', message: 'table for 2 in the west village friday at 7', expect: { neighborhood: 'West Village', partySize: 2, date: '2026-10-02', exactTime: '19:00' }, tags: ['full'] },
  { id: 'full-soma', message: 'dinner for four in soma saturday 7-9', expect: { neighborhood: 'SoMa', partySize: 4, date: '2026-10-03', timeFrom: '19:00', timeTo: '21:00' }, tags: ['full'] },

  // Multi-turn — the new message updates a saved intent, the rest carries over
  { id: 'ctx-change-party', message: 'actually make it a table for 4', previous: { neighborhood: 'West Village', date: '2026-10-02', partySize: 2 }, expect: { partySize: 4, neighborhood: 'West Village', date: '2026-10-02' }, tags: ['context'] },
  { id: 'ctx-add-time', message: "let's do 8pm instead", previous: { neighborhood: 'SoMa', date: '2026-10-03', partySize: 2 }, expect: { exactTime: '20:00', neighborhood: 'SoMa' }, tags: ['context'] },
  { id: 'ctx-switch-area', message: 'try the mission instead', previous: { neighborhood: 'SoMa', date: '2026-10-03', partySize: 2, timeFrom: '19:00', timeTo: '21:00' }, expect: { neighborhood: 'Mission', partySize: 2, date: '2026-10-03' }, tags: ['context'] },

  // Known-hard cases: colloquial phrasing the deterministic parser misses today. These are where the model agent
  // earns its place, and they keep the eval honest — the reported score is not a curated 100%.
  { id: 'hard-couple', message: 'a table for a couple', expect: { partySize: 2 }, tags: ['hard', 'party'] },
  { id: 'hard-me-and-wife', message: 'just me and my wife', expect: { partySize: 2 }, tags: ['hard', 'party'] },
  { id: 'hard-half-past', message: 'half past seven', expect: { exactTime: '19:30' }, tags: ['hard', 'time'] },
  { id: 'hard-7ish', message: 'book us for 7ish', expect: { exactTime: '19:00' }, tags: ['hard', 'time'] },
  { id: 'hard-two-dozen', message: 'a table for two dozen', expect: { partySize: undefined }, tags: ['hard', 'party'] },
];
