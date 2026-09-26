import { motion } from 'motion/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
type Variant = 'primary' | 'ghost' | 'quiet';
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children: ReactNode };
export function Button({ variant = 'primary', className = '', children, ...rest }: Props) {
  return <motion.button whileTap={{ scale: 0.97 }} whileHover={rest.disabled ? undefined : { y: -1 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} className={`btn btn-${variant} ${className}`} {...(rest as object)}>{children}</motion.button>;
}
