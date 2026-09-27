import pg from 'pg';
import { ledgerEntrySchema, type LedgerEntry, type LedgerStore } from './ledger';
import { profileSchema, emptyProfile, type Profile, type ProfileReaderWriter } from './profile';
import { log } from './logger';

/**
 * Real persistence: confirmed bookings and the diner profile in Postgres, so they survive a restart or redeploy
 * (Render's free disk is ephemeral, so the JSON-file store resets there). One `Database` implements both the
 * ledger and the profile store, chosen in main.ts when DATABASE_URL is set; otherwise the file stores are used.
 */
export class Database implements LedgerStore, ProfileReaderWriter {
  private pool: pg.Pool;
  private ready: Promise<void>;
  constructor(connectionString: string, private profileKey = 'default') {
    // Hosted Postgres (Render, Neon, …) requires TLS; local Postgres usually does not.
    const ssl = /\bsslmode=require\b/.test(connectionString) || /\.(render\.com|neon\.tech)\b/.test(connectionString) ? { rejectUnauthorized: false } : undefined;
    this.pool = new pg.Pool({ connectionString, max: 4, ...(ssl ? { ssl } : {}) });
    this.pool.on('error', err => log('error', 'db_pool_error', { message: err.message }));
    this.ready = this.migrate();
    // Handle a connection/migration failure so it logs instead of surfacing as an unhandled rejection; methods
    // still await this.ready and throw if it failed.
    void this.ready.catch(err => log('error', 'db_migrate_failed', { message: err instanceof Error ? err.message : String(err) }));
  }

  private async migrate() {
    await this.pool.query('CREATE TABLE IF NOT EXISTS bookings (id text PRIMARY KEY, confirmed_at timestamptz NOT NULL, data jsonb NOT NULL)');
    await this.pool.query('CREATE TABLE IF NOT EXISTS profiles (key text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
  }

  async list(): Promise<LedgerEntry[]> {
    await this.ready;
    const { rows } = await this.pool.query('SELECT data FROM bookings ORDER BY confirmed_at DESC LIMIT 500');
    return rows.map(r => ledgerEntrySchema.parse(r.data));
  }
  async append(entry: LedgerEntry): Promise<void> {
    await this.ready;
    const e = ledgerEntrySchema.parse(entry);
    await this.pool.query('INSERT INTO bookings (id, confirmed_at, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', [e.id, e.confirmedAt, JSON.stringify(e)]);
  }

  async read(): Promise<Profile> {
    await this.ready;
    const { rows } = await this.pool.query('SELECT data FROM profiles WHERE key = $1', [this.profileKey]);
    if (!rows[0]) return { ...emptyProfile };
    try { return profileSchema.parse(rows[0].data); } catch { return { ...emptyProfile }; }
  }
  async write(raw: unknown): Promise<Profile> {
    await this.ready;
    const profile = profileSchema.parse(raw);
    await this.pool.query('INSERT INTO profiles (key, data, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET data = $2, updated_at = now()', [this.profileKey, JSON.stringify(profile)]);
    return profile;
  }

  async close() { await this.pool.end().catch(() => {}); }
}
