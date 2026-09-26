import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from './store/store';
import { Sidebar } from './ui/Sidebar';
import { ConciergePage } from './features/chat/ConciergePage';
import { ReservationsPage } from './features/bookings/ReservationsPage';
import { SettingsPage } from './features/profile/SettingsPage';
import { JobCard } from './features/booking/JobCard';
import { fadeSwap } from './lib/motion';

export function App() {
  const theme = useStore(s => s.theme); const page = useStore(s => s.page);
  const loadProfile = useStore(s => s.loadProfile); const loadBookings = useStore(s => s.loadBookings); const loadAreas = useStore(s => s.loadAreas);
  const error = useStore(s => s.error);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { void loadProfile(); void loadBookings(); void loadAreas(); }, [loadProfile, loadBookings, loadAreas]);

  return <div className="shell">
    <Sidebar />
    <main className="main">
      <AnimatePresence mode="wait">
        <motion.div key={page} className="page-wrap" variants={fadeSwap} initial="hidden" animate="show" exit="exit">
          {page === 'concierge' && <ConciergePage />}
          {page === 'reservations' && <ReservationsPage />}
          {page === 'settings' && <SettingsPage />}
        </motion.div>
      </AnimatePresence>
    </main>
    <AnimatePresence>{error && <motion.div className="toast bad" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} onClick={() => useStore.getState().setError(null)}>{error}</motion.div>}</AnimatePresence>
    <JobCard />
  </div>;
}
