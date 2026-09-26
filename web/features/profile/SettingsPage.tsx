import { useEffect, useState } from 'react';
import { useStore } from '../../store/store';
import { ContactFields } from './ProfileForm';
import { Button } from '../../ui/Button';
import { profileComplete } from '../../lib/format';

export function SettingsPage() {
  const profile = useStore(s => s.profile); const save = useStore(s => s.saveProfile);
  const theme = useStore(s => s.theme); const toggle = useStore(s => s.toggleTheme);
  const [draft, setDraft] = useState(profile.saved);
  // If Settings mounts before the profile has loaded, fill the form once it arrives.
  useEffect(() => { if (profile.loaded) setDraft(profile.saved); }, [profile.loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saved, setSaved] = useState(false); const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile.saved);
  return <div className="page">
    <header className="page-head"><h1>Settings</h1><p className="muted">Your details and how Tavola looks. Everything stays on this device.</p></header>
    <section className="card settings-card">
      <h3>Diner profile</h3>
      <p className="muted">Used to fill the restaurant’s booking form when you confirm a table.</p>
      <ContactFields value={draft} onChange={c => { setDraft(c); setSaved(false); }} />
      <div className="row-end">{saved && <span className="notice ok">Saved</span>}<Button disabled={!dirty || busy || !profileComplete(draft)} onClick={async () => { setBusy(true); try { await save(draft); setSaved(true); } finally { setBusy(false); } }}>{busy ? 'Saving…' : 'Save details'}</Button></div>
    </section>
    <section className="card settings-card">
      <h3>Appearance</h3>
      <div className="setting-row"><div><strong>Theme</strong><p className="muted quiet">Follows your system until you choose.</p></div><Button variant="ghost" onClick={toggle}>{theme === 'dark' ? 'Switch to light' : 'Switch to dark'}</Button></div>
    </section>
  </div>;
}
