import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from './confirm-dialog';

describe('ConfirmDialog', () => {
  it('chama onConfirm/onCancel a partir dos rótulos informados', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();

    render(
      <ConfirmDialog
        open
        title="Fechar a mesa?"
        description="Isso faz cash-out de todos os jogadores sentados."
        confirmLabel="Sim, fechar mesa"
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(
      screen.getByText('Isso faz cash-out de todos os jogadores sentados.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText('Sim, fechar mesa'));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Cancelar'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('desabilita o cancelar enquanto loading', () => {
    render(
      <ConfirmDialog open title="Título" loading onConfirm={jest.fn()} onCancel={jest.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  });
});
