/**
 * Curated SevenRooms venues. SevenRooms has no public venue directory or search endpoint (its /explore index
 * returns 404), so coverage is a hand-checked list of URL slugs. Every slug here was validated against the public
 * availability endpoint and widget_info on 2026-09-26. Add a venue by its slug from sevenrooms.com/explore/<slug>/...
 */
export type Venue = { slug: string; name: string; city: string; neighborhood: string; timezone: string; address: string; cuisine: string; website?: string };

export const venues: Venue[] = [
  // New York
  { slug: 'dantewestvillage', name: 'Dante West Village', city: 'New York', neighborhood: 'West Village', timezone: 'America/New_York', address: '551 Hudson St', cuisine: 'Italian-leaning seafood & cocktails', website: 'https://www.dante-nyc.com/wv/' },
  { slug: 'redfarmwestvillage', name: 'RedFarm West Village', city: 'New York', neighborhood: 'West Village', timezone: 'America/New_York', address: '529 Hudson St', cuisine: 'Modern Chinese & dim sum', website: 'https://www.redfarmnyc.com' },
  { slug: 'miriamwestvillage', name: 'Miriam West Village', city: 'New York', neighborhood: 'West Village', timezone: 'America/New_York', address: '140 7th Ave S', cuisine: 'Israeli & Mediterranean', website: 'https://westvillage.miriamrestaurant.com/' },
  { slug: 'motekcafewestvillage', name: 'Motek West Village', city: 'New York', neighborhood: 'West Village', timezone: 'America/New_York', address: '184 Bleecker St', cuisine: 'Mediterranean café', website: 'https://motekcafe.com/' },
  { slug: 'theeightysix', name: 'The Eighty Six', city: 'New York', neighborhood: 'West Village', timezone: 'America/New_York', address: '86 Bedford St', cuisine: 'Steakhouse', website: 'https://www.the86.nyc/' },
  { slug: 'wildcherry', name: 'Wild Cherry', city: 'New York', neighborhood: 'West Village', timezone: 'America/New_York', address: '38 Commerce St', cuisine: 'Bar & restaurant at Cherry Lane Theatre', website: 'https://www.wildcherrynyc.com/' },
  { slug: 'sarabethsgreenwichvillage', name: "Sarabeth's Greenwich Village", city: 'New York', neighborhood: 'Greenwich Village', timezone: 'America/New_York', address: '100 W Houston St', cuisine: 'American, brunch & dinner', website: 'https://www.sarabethsrestaurants.com/greenwich-village/' },
  { slug: 'aquanyc', name: 'Aqua Roma', city: 'New York', neighborhood: 'Flatiron', timezone: 'America/New_York', address: '902 Broadway', cuisine: 'Italian' },
  { slug: 'lucciola', name: 'Lucciola', city: 'New York', neighborhood: 'Upper West Side', timezone: 'America/New_York', address: '621 Amsterdam Ave', cuisine: 'Italian', website: 'https://www.lucciolanyc.com/' },
  // San Francisco
  { slug: 'bourbonsteaksanfrancisco', name: 'Bourbon Steak San Francisco', city: 'San Francisco', neighborhood: 'Union Square', timezone: 'America/Los_Angeles', address: '335 Powell St', cuisine: 'Steakhouse by Michael Mina', website: 'https://www.michaelmina.net/restaurants' },
  { slug: 'chottomattesanfrancisco', name: 'Chotto Matte San Francisco', city: 'San Francisco', neighborhood: 'Union Square', timezone: 'America/Los_Angeles', address: "50 O'Farrell St", cuisine: 'Nikkei (Japanese-Peruvian), rooftop', website: 'https://chotto-matte.com/sanfrancisco' },
  { slug: '8thrule', name: 'The Eighth Rule', city: 'San Francisco', neighborhood: 'Union Square', timezone: 'America/Los_Angeles', address: '335 Powell St', cuisine: 'Bourbon bar & small plates', website: 'https://www.michaelmina.net/restaurants' },
  { slug: 'elementsone65', name: 'Elements Bar & Lounge', city: 'San Francisco', neighborhood: 'Union Square', timezone: 'America/Los_Angeles', address: "165 O'Farrell St", cuisine: 'Cocktails & bites at ONE65', website: 'https://one65sf.com/' },
  { slug: 'verjus', name: 'Verjus', city: 'San Francisco', neighborhood: 'Jackson Square', timezone: 'America/Los_Angeles', address: '550 Washington St', cuisine: 'French wine bar & cave', website: 'https://www.verjuscave.com/' },
  { slug: 'cotogna', name: 'Cotogna', city: 'San Francisco', neighborhood: 'Jackson Square', timezone: 'America/Los_Angeles', address: '490 Pacific Ave', cuisine: 'Rustic Italian', website: 'http://cotognasf.com/' },
  { slug: 'quince', name: 'Quince', city: 'San Francisco', neighborhood: 'Jackson Square', timezone: 'America/Los_Angeles', address: '470 Pacific Ave', cuisine: 'Tasting menu, Michelin-starred', website: 'https://www.quincerestaurant.com/' },
  { slug: 'bigfour', name: 'The Big Four', city: 'San Francisco', neighborhood: 'Nob Hill', timezone: 'America/Los_Angeles', address: '1075 California St', cuisine: 'Classic American at the Huntington Hotel', website: 'https://www.thehuntingtonhotel.com/the-big-four/' },
  { slug: 'benusf', name: 'Benu', city: 'San Francisco', neighborhood: 'SoMa', timezone: 'America/Los_Angeles', address: '22 Hawthorne St', cuisine: 'Tasting menu, three Michelin stars', website: 'https://www.benusf.com/' },
  { slug: 'sanhowon', name: 'San Ho Won', city: 'San Francisco', neighborhood: 'Mission', timezone: 'America/Los_Angeles', address: '2170 Bryant St', cuisine: 'Korean barbecue', website: 'https://sanhowon.com/' },
  { slug: 'julessanfrancisco', name: 'Jules', city: 'San Francisco', neighborhood: 'Lower Haight', timezone: 'America/Los_Angeles', address: '237 Fillmore St', cuisine: 'Pizza', website: 'https://www.julespizza.com/' },
  { slug: 'estiatorioornossf', name: 'Estiatorio Ornos', city: 'San Francisco', neighborhood: 'Financial District', timezone: 'America/Los_Angeles', address: '252 California St', cuisine: 'Greek seafood', website: 'https://www.michaelmina.net/' },
];

/** A place the diner can ask for. Cities cover every venue in that city; neighborhoods cover their own venues. */
export type Area = { name: string; city: string; phrase: string; aliases: string[] };
export const areas: Area[] = [
  { name: 'New York', city: 'New York', phrase: 'in New York', aliases: ['new york', 'new york city', 'nyc', 'manhattan'] },
  { name: 'West Village', city: 'New York', phrase: 'in the West Village', aliases: ['west village', 'wv', 'the village', 'village'] },
  { name: 'Greenwich Village', city: 'New York', phrase: 'in Greenwich Village', aliases: ['greenwich village', 'greenwich'] },
  { name: 'Flatiron', city: 'New York', phrase: 'in Flatiron', aliases: ['flatiron', 'gramercy'] },
  { name: 'Upper West Side', city: 'New York', phrase: 'on the Upper West Side', aliases: ['upper west side', 'uws'] },
  { name: 'San Francisco', city: 'San Francisco', phrase: 'in San Francisco', aliases: ['san francisco', 'sf', 'san fran', 'frisco'] },
  { name: 'Union Square', city: 'San Francisco', phrase: 'around Union Square', aliases: ['union square', 'downtown sf', 'downtown san francisco'] },
  { name: 'Jackson Square', city: 'San Francisco', phrase: 'in Jackson Square', aliases: ['jackson square', 'north beach'] },
  { name: 'Nob Hill', city: 'San Francisco', phrase: 'on Nob Hill', aliases: ['nob hill'] },
  { name: 'SoMa', city: 'San Francisco', phrase: 'in SoMa', aliases: ['soma', 'south of market'] },
  { name: 'Mission', city: 'San Francisco', phrase: 'in the Mission', aliases: ['mission', 'the mission', 'mission district'] },
  { name: 'Lower Haight', city: 'San Francisco', phrase: 'in the Lower Haight', aliases: ['lower haight', 'haight'] },
  { name: 'Financial District', city: 'San Francisco', phrase: 'in the Financial District', aliases: ['financial district', 'fidi', 'embarcadero'] },
];
export const neighborhoods = areas.map(area => area.name);
export const cities = [...new Set(areas.map(area => area.city))];
export function coverageSummary() {
  return cities.map(city => `${city} (${areas.filter(a => a.city === city && a.name !== city).map(a => a.name).join(', ')})`).join(' and ');
}
export function areaPhrase(name: string) { return areas.find(area => area.name === name)?.phrase ?? `in ${name}`; }

const aliasList = areas.flatMap(area => area.aliases.map(word => ({ name: area.name, city: area.city, word }))).sort((a, b) => b.word.length - a.word.length);
/** Returns the canonical covered area named in free text, or undefined. A neighborhood beats its city ("union square in SF"); otherwise the longest alias wins. */
export function detectNeighborhood(text: string): string | undefined {
  const lower = text.toLowerCase();
  const hits = aliasList.filter(({ word }) => new RegExp(`\\b${word}\\b`).test(lower));
  return (hits.find(hit => hit.name !== hit.city) ?? hits[0])?.name;
}

/** Places people commonly ask for that the demo does not cover. Anything with a US state suffix also counts. */
const elsewhere = ['fremont', 'san jose', 'oakland', 'palo alto', 'berkeley', 'los angeles', 'san diego', 'seattle', 'portland', 'chicago', 'boston', 'austin', 'dallas', 'houston', 'miami', 'atlanta', 'denver', 'philadelphia', 'washington dc', 'las vegas', 'london', 'paris', 'toronto', 'brooklyn', 'queens', 'jersey city', 'hoboken', 'midtown', 'soho', 'tribeca', 'east village', 'lower east side', 'williamsburg', 'harlem', 'chelsea', 'upper east side', 'marina', 'castro', 'hayes valley', 'richmond', 'sunset'];
const notPlaces = /^(?:evening|morning|afternoon|night|noon|lunch|dinner|brunch|mood|city|town|area|neighborhood|neighbourhood|village)$/i;
export function detectUnsupportedLocation(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (detectNeighborhood(lower)) return undefined;
  const named = elsewhere.find(place => new RegExp(`\\b${place}\\b`).test(lower));
  if (named) return named.replace(/\b\w/g, c => c.toUpperCase());
  // "in the Fermont", "near Union City", "around Pleasanton": any place phrase that is not a covered alias.
  const phrase = text.match(/\b(?:in|near|around|at)\s+(?:the\s+)?([A-Za-z][A-Za-z.'\-]*(?:\s[A-Za-z][A-Za-z.'\-]*){0,3}?)(?=\s*(?:,|\.|!|\?|$|\s(?:on|for|this|next|tomorrow|today|tonight|at|around|between|from|to|with|and|sometime|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|\d)\b))/i);
  if (phrase) {
    const place = phrase[1].trim();
    if (!notPlaces.test(place) && !detectNeighborhood(place) && place.length >= 3) return place.replace(/\b\w/g, c => c.toUpperCase());
  }
  const state = text.match(/\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)?),?\s(?:CA|WA|OR|TX|FL|IL|MA|NJ|CT|PA|GA|CO|AZ|NV|NC|VA|MD|DC|OH|MI|MN|WI|TN|MO|IN|UT|SC|AL|LA|KY|OK|IA|KS|AR|NM|NE|ID|HI|NH|ME|RI|MT|DE|SD|ND|AK|VT|WV|WY|MS)\b/);
  return state ? state[0] : undefined;
}

/** Venues for a covered area. A city name returns every venue in that city. Unknown names return nothing. */
export function venuesFor(name?: string): Venue[] {
  if (!name) return [];
  const area = areas.find(a => a.name.toLowerCase() === name.toLowerCase());
  if (!area) return [];
  return area.name === area.city ? venues.filter(v => v.city === area.city) : venues.filter(v => v.neighborhood === area.name);
}

export function venueBySlug(slug: string) { return venues.find(venue => venue.slug === slug); }

/** The city an area belongs to (a city name maps to itself), or undefined if we don't cover it. */
export function cityOf(area?: string): string | undefined {
  if (!area) return undefined;
  const match = areas.find(a => a.name.toLowerCase() === area.toLowerCase());
  return match?.city;
}

/** Venues in the same city as `area` but a different neighborhood — used to suggest alternatives when the asked-for area is dry. Empty when `area` is a whole city (already city-wide). */
export function nearbyVenues(area?: string): Venue[] {
  const city = cityOf(area);
  if (!city || !area || area.toLowerCase() === city.toLowerCase()) return [];
  return venues.filter(v => v.city === city && v.neighborhood.toLowerCase() !== area.toLowerCase());
}
