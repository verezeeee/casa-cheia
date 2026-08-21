import { render, screen } from '@testing-library/react';
import { Badge } from './badge';

describe('Badge', () => {
  it('renderiza o texto do status', () => {
    render(<Badge>ATIVO</Badge>);

    expect(screen.getByText('ATIVO')).toBeInTheDocument();
  });

  it('usa a variante neutral por padrão', () => {
    render(<Badge>PENDENTE</Badge>);

    expect(screen.getByText('PENDENTE')).toHaveAttribute('data-variant', 'neutral');
  });

  it.each(['success', 'warning', 'danger', 'info', 'neutral'] as const)(
    'renderiza a variante %s',
    (variant) => {
      render(<Badge variant={variant}>STATUS</Badge>);

      expect(screen.getByText('STATUS')).toHaveAttribute('data-variant', variant);
    },
  );

  it('aplica className extra', () => {
    render(<Badge className="ml-2">ATIVO</Badge>);

    expect(screen.getByText('ATIVO')).toHaveClass('ml-2');
  });
});
