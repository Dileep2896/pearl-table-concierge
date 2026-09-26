import { useStore } from '../../store/store';
export function ProfileBadge({ onEdit, editing }: { onEdit: () => void; editing: boolean }) {
  const p = useStore(s => s.profile);
  return <button className="profile-badge" onClick={onEdit}>
    {p.complete ? <><span className="avatar">{p.saved.firstName[0]}{p.saved.lastName[0]}</span><span className="profile-name">{p.saved.firstName} {p.saved.lastName}</span></> : <span className="muted">Add your details</span>}
    <span className="profile-edit">{editing ? 'Close' : p.complete ? 'Edit' : ''}</span>
  </button>;
}
