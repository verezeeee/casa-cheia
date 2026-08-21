import { render, screen } from '@testing-library/react';
import { Button } from './button';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renderiza apenas o título quando não há descrição/ação', () => {
    render(<EmptyState title="Nenhuma transação ainda" />);

    expect(screen.getByText('Nenhuma transação ainda')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renderiza descrição e ação quando informadas', () => {
    render(
      <EmptyState
        title="Nenhuma transação ainda"
        description="Seus depósitos e saques aparecerão aqui."
        action={<Button>Depositar</Button>}
      />,
    );

    expect(screen.getByText('Seus depósitos e saques aparecerão aqui.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Depositar' })).toBeInTheDocument();
  });

  it('trata o ícone como decorativo', () => {
    render(<EmptyState title="Sem dados" icon={<span data-testid="icone">♠</span>} />);

    const icon = screen.getByTestId('icone').parentElement;
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('aplica className extra', () => {
    render(<EmptyState title="Sem dados" className="mt-8" />);

    expect(screen.getByText('Sem dados').parentElement).toHaveClass('mt-8');
  });
});
