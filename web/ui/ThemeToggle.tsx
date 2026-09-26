import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../store/store';
import { Icon } from './Icon';
export function ThemeToggle() {
  const theme = useStore(s => s.theme); const toggle = useStore(s => s.toggleTheme);
  return <button className="theme-toggle" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
    <AnimatePresence mode="wait" initial={false}>
      <motion.span key={theme} initial={{ opacity: 0, rotate: -40, scale: 0.6 }} animate={{ opacity: 1, rotate: 0, scale: 1 }} exit={{ opacity: 0, rotate: 40, scale: 0.6 }} transition={{ duration: 0.28 }} style={{ display: 'flex' }}>
        <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={18} />
      </motion.span>
    </AnimatePresence>
  </button>;
}
