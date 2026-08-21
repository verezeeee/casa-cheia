import { fireEvent, render, screen } from '@testing-library/react';
import { Toast } from './toast';

describe('Toast', () => {
  it('usa role="status" (polido) para sucesso', () => {
    render(<Toast type="success" message="Depósito confirmado" />);

    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Depósito confirmado');
    expect(toast).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('usa role="status" para info por padrão', () => {
    render(<Toast message="Processando" />);

    expect(screen.getByRole('status')).toHaveAttribute('data-type', 'info');
  });

  it.each(['error', 'warning'] as const)('usa role="alert" (assertivo) para %s', (type) => {
    render(<Toast type={type} message="Falha ao sacar" />);

    const toast = screen.getByRole('alert');
    expect(toast).toHaveAttribute('aria-live', 'assertive');
    expect(toast).toHaveAttribute('data-type', type);
  });

  it('exibe título quando informado', () => {
    render(<Toast type="success" title="Tudo certo" message="Saque enviado" />);

    expect(screen.getByText('Tudo certo')).toBeInTheDocument();
    expect(screen.getByText('Saque enviado')).toBeInTheDocument();
  });

  it('não renderiza botão de fechar sem onClose', () => {
    render(<Toast message="Sem ação" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('chama onClose ao clicar no botão de fechar', () => {
    const onClose = jest.fn();
    render(<Toast type="error" message="Erro" onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Fechar notificação' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('permite customizar o rótulo acessível do botão de fechar', () => {
    render(<Toast message="Erro" onClose={jest.fn()} closeLabel="Dispensar" />);

    expect(screen.getByRole('button', { name: 'Dispensar' })).toBeInTheDocument();
  });
});
