import { render, screen } from '@testing-library/react';
import { Spinner } from './spinner';

describe('Spinner', () => {
  it('expõe role="status" com texto padrão para leitores de tela', () => {
    render(<Spinner />);

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
  });

  it('permite customizar o texto acessível', () => {
    render(<Spinner label="Carregando saldo" />);

    expect(screen.getByRole('status')).toHaveTextContent('Carregando saldo');
  });

  it.each(['sm', 'md', 'lg'] as const)('renderiza o tamanho %s', (size) => {
    render(<Spinner size={size} />);

    expect(screen.getByTestId('spinner-circle')).toBeInTheDocument();
  });

  it('quando decorativo não anuncia status', () => {
    render(<Spinner decorative />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Carregando...')).not.toBeInTheDocument();
  });

  it('aplica className extra', () => {
    render(<Spinner className="text-emerald-500" />);

    expect(screen.getByRole('status')).toHaveClass('text-emerald-500');
  });
});
