'use client';

import { motion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * Física de motion única do app (spring, não linear) — concentrada aqui em
 * vez de repetida em cada lista que faz stagger de entrada.
 */
const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 20 } },
};

interface RevealProps {
  children: ReactNode;
  className?: string;
  as?: 'ul' | 'div';
}

/** Container: troque `<ul>`/`<div>` pelo equivalente aqui para o stagger dos filhos `RevealItem`. */
export function Reveal({ children, className, as = 'ul' }: RevealProps) {
  const Comp = as === 'div' ? motion.div : motion.ul;
  return (
    <Comp initial="hidden" animate="show" variants={container} className={className}>
      {children}
    </Comp>
  );
}

interface RevealItemProps {
  children: ReactNode;
  className?: string;
  as?: 'li' | 'div';
}

/** Item: troque `<li>`/`<div>` pelo equivalente aqui dentro de um `Reveal`. */
export function RevealItem({ children, className, as = 'li' }: RevealItemProps) {
  const Comp = as === 'div' ? motion.div : motion.li;
  return (
    <Comp variants={item} className={className}>
      {children}
    </Comp>
  );
}
