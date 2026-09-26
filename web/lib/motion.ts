import type { Transition, Variants } from 'motion/react';
export const spring: Transition = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 };
export const springSoft: Transition = { type: 'spring', stiffness: 260, damping: 30 };
export const ease: Transition = { duration: 0.4, ease: [0.16, 1, 0.3, 1] };
/** Cards and rows enter with a small, quiet rise; used with staggerChildren on the container. */
export const riseItem: Variants = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: springSoft } };
export const stagger = (delay = 0, gap = 0.05): Variants => ({ hidden: {}, show: { transition: { delayChildren: delay, staggerChildren: gap } } });
export const overlayFade: Variants = { hidden: { opacity: 0 }, show: { opacity: 1 }, exit: { opacity: 0 } };
export const panelPop: Variants = { hidden: { opacity: 0, y: 24, scale: 0.985 }, show: { opacity: 1, y: 0, scale: 1, transition: spring }, exit: { opacity: 0, y: 16, scale: 0.99, transition: { duration: 0.2 } } };
