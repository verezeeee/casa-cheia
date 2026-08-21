import { render, screen } from '@testing-library/react';
import { Card } from './card';

describe('Card', () => {
  it('renderiza o conteúdo', () => {
    render(<Card>Saldo disponível</Card>);

    expect(screen.getByText('Saldo disponível')).toBeInTheDocument();
  });

  it('renderiza título como heading e rodapé quando informados', () => {
    render(
      <Card title="Carteira" footer={<span>Atualizado agora</span>}>
        R$ 150,00
      </Card>,
    );

    expect(screen.getByRole('heading', { name: 'Carteira' })).toBeInTheDocument();
    expect(screen.getByText('Atualizado agora')).toBeInTheDocument();
  });

  it.each(['none', 'sm', 'md', 'lg'] as const)('aplica o padding %s', (padding) => {
    render(
      <Card padding={padding} data-testid="card">
        conteúdo
      </Card>,
    );

    expect(screen.getByTestId('card')).toBeInTheDocument();
  });

  it('repassa className e props nativas do container', () => {
    render(
      <Card className="mt-2" data-testid="card" aria-label="Resumo">
        conteúdo
      </Card>,
    );

    const card = screen.getByTestId('card');
    expect(card).toHaveClass('mt-2');
    expect(card).toHaveAttribute('aria-label', 'Resumo');
  });
});
