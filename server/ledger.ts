import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod/v4';

/** A confirmed reservation, kept locally so it survives a restart. Contact details are not stored. */
export const ledgerEntrySchema = z.object({
  id: z.string(), confirmedAt: z.iso.datetime(), venue: z.string(), venueName: z.string(), city: z.string(),
  date: z.string(), time: z.string(), partySize: z.number().int(), reference: z.string().optional(), pageUrl: z.string().optional(), policy: z.string().optional(),
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

/** A store of confirmed reservations. Backed by a JSON file locally, or Postgres when DATABASE_URL is set. */
export interface LedgerStore {
  list(): Promise<LedgerEntry[]>;
  append(entry: LedgerEntry): Promise<void>;
}

export class BookingLedger implements LedgerStore {
  private writing: Promise<void> = Promise.resolve();
  constructor(private path: string) {}
  async list(): Promise<LedgerEntry[]> {
    let raw: unknown;
    try { raw = JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    // Skip any malformed/legacy row rather than 500-ing the whole list.
    return Array.isArray(raw) ? raw.flatMap(e => { const p = ledgerEntrySchema.safeParse(e); return p.success ? [p.data] : []; }) : [];
  }
  /** Appends atomically with respect to other appends in this process. */
  append(entry: LedgerEntry): Promise<void> {
    this.writing = this.writing.then(async () => {
      const entries = await this.list().catch(() => [] as LedgerEntry[]);
      entries.unshift(ledgerEntrySchema.parse(entry));
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, JSON.stringify(entries.slice(0, 500), null, 2) + '\n', { mode: 0o600 });
    });
    return this.writing;
  }
}
