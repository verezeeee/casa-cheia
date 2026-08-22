import { fireEvent, render, screen } from '@testing-library/react';
import { Dialog } from './dialog';

describe('Dialog', () => {
  it('expõe título e conteúdo quando open', () => {
    render(
      <Dialog open onClose={jest.fn()} title="Fechar a mesa?">
        Isso faz cash-out de todos.
      </Dialog>,
    );

    expect(screen.getByRole('dialog', { name: 'Fechar a mesa?' })).toBeInTheDocument();
    expect(screen.getByText('Isso faz cash-out de todos.')).toBeInTheDocument();
  });

  it('não expõe o dialog quando fechado', () => {
    render(
      <Dialog open={false} onClose={jest.fn()} title="Fechar a mesa?">
        Conteúdo
      </Dialog>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renderiza o footer e dispara callbacks de clique', () => {
    const onConfirm = jest.fn();
    render(
      <Dialog
        open
        onClose={jest.fn()}
        title="Título"
        footer={<button onClick={onConfirm}>Ok</button>}
      />,
    );

    fireEvent.click(screen.getByText('Ok'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('fecha ao clicar fora do card (fora do bounding box do conteúdo)', () => {
    const onClose = jest.fn();
    render(
      <Dialog open onClose={onClose} title="Título">
        Conteúdo
      </Dialog>,
    );

    fireEvent.click(screen.getByRole('dialog'), { clientX: 9999, clientY: 9999 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('não fecha ao clicar em conteúdo interno', () => {
    const onClose = jest.fn();
    render(
      <Dialog open onClose={onClose} title="Título">
        Conteúdo
      </Dialog>,
    );

    fireEvent.click(screen.getByText('Conteúdo'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
