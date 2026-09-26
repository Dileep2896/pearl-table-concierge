import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';

/** Diner profile kept in a local, git-ignored JSON file. It is only ever sent to the booking widget the diner confirms. */
export const profileSchema = z.object({
  firstName: z.string().trim().max(60).default(''),
  lastName: z.string().trim().max(60).default(''),
  email: z.string().trim().max(120).default(''),
  phone: z.string().trim().max(20).default(''),
});
export type Profile = z.infer<typeof profileSchema>;
export const emptyProfile: Profile = { firstName: '', lastName: '', email: '', phone: '' };
export const defaultProfilePath = join(dirname(fileURLToPath(import.meta.url)), '..', '.local', 'profile.json');

export function isComplete(profile: Profile) {
  return Boolean(profile.firstName && profile.lastName && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email) && profile.phone.replace(/\D/g, '').length >= 10);
}

export class ProfileStore {
  constructor(private path = process.env.PEARL_DEMO_PROFILE || defaultProfilePath) {}
  async read(): Promise<Profile> {
    try { return profileSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...emptyProfile }; console.warn(JSON.stringify({ event: 'demo_profile_unreadable', message: (error as Error).message })); return { ...emptyProfile }; }
  }
  async write(raw: unknown): Promise<Profile> {
    const profile = profileSchema.parse(raw);
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(profile, null, 2) + '\n', { mode: 0o600 });
    return profile;
  }
}
