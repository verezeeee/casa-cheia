import Link, { type LinkProps } from 'next/link';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface TextLinkProps
  extends LinkProps, Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps | 'className'> {
  children: ReactNode;
  className?: string;
}

/**
 * Link de texto no tom de destaque — "Cadastre-se"/"Entrar"/"Ir para o
 * lobby" etc. Era `className` copiada igual em cada call site; centralizado
 * aqui pra a transição do hover (e qualquer ajuste futuro) valer em todo
 * lugar de uma vez.
 */
export function TextLink({ className, children, ...rest }: TextLinkProps) {
  return (
    <Link
      className={cn(
        'font-medium text-accent underline-offset-2 transition-colors duration-200 hover:underline',
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}
