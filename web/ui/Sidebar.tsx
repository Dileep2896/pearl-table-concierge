import { motion } from 'motion/react';
import { useStore, type Page } from '../store/store';
import { Icon } from './Icon';
import { Pearl } from './Pearl';
import { ThemeToggle } from './ThemeToggle';

const items: { id: Page; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { id: 'concierge', label: 'Concierge', icon: 'spark' },
  { id: 'reservations', label: 'Reservations', icon: 'book' },
  { id: 'settings', label: 'Settings', icon: 'guests' },
];

export function Sidebar() {
  const page = useStore(s => s.page); const setPage = useStore(s => s.setPage);
  const count = useStore(s => s.bookings.length);
  const profile = useStore(s => s.profile);
  return <aside className="sidebar">
    <button className="side-brand" onClick={() => setPage('concierge')}><Pearl size={30} /><div><span className="brand-name">Pearl</span><span className="brand-sub">Table concierge</span></div></button>
    <nav className="side-nav">
      {items.map(it => <button key={it.id} className={`nav-item ${page === it.id ? 'on' : ''}`} onClick={() => setPage(it.id)}>
        {page === it.id && <motion.span layoutId="nav-active" className="nav-active" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
        <span className="nav-icon"><Icon name={it.icon} size={19} /></span>
        <span className="nav-label">{it.label}</span>
        {it.id === 'reservations' && count > 0 && <span className="nav-badge">{count}</span>}
      </button>)}
    </nav>
    <div className="side-foot">
      <button className="side-profile" onClick={() => setPage('settings')}>
        {profile.complete ? <><span className="avatar">{profile.saved.firstName[0]}{profile.saved.lastName[0]}</span><span className="side-profile-name">{profile.saved.firstName} {profile.saved.lastName}</span></> : <span className="muted quiet">Add your details</span>}
      </button>
      <ThemeToggle />
    </div>
  </aside>;
}
