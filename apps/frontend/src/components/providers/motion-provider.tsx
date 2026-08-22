'use client';

import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * Desliga animação no nível do framer-motion quando o SO pede motion
 * reduzido. A media query em `globals.css` cobre CSS puro (`transition`,
 * `animation`); o transform/opacity dirigido por JS do framer-motion
 * precisa desse opt-out separado.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
