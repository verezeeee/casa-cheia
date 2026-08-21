import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from './button';

describe('Button', () => {
  it('renderiza o conteúdo com type="button" por padrão', () => {
    render(<Button>Depositar</Button>);

    const button = screen.getByRole('button', { name: 'Depositar' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-busy');
  });

  it('respeita o type informado (ex.: submit em formulários)', () => {
    render(<Button type="submit">Confirmar</Button>);

    expect(screen.getByRole('button', { name: 'Confirmar' })).toHaveAttribute('type', 'submit');
  });

  it('dispara onClick quando habilitado', () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Sacar</Button>);

    fireEvent.click(screen.getByRole('button', { name: 'Sacar' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('em loading fica desabilitado, marca aria-busy e mostra o spinner', () => {
    render(<Button loading>Sacar</Button>);

    const button = screen.getByRole('button', { name: 'Sacar' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('spinner-circle')).toBeInTheDocument();
  });

  it('NÃO dispara onClick quando loading=true', () => {
    const onClick = jest.fn();
    render(
      <Button loading onClick={onClick}>
        Sacar
      </Button>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sacar' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('NÃO dispara onClick quando disabled=true', () => {
    const onClick = jest.fn();
    render(
      <Button disabled onClick={onClick}>
        Sacar
      </Button>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sacar' }));

    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sacar' })).toBeDisabled();
  });

  it('substitui o label por loadingText enquanto carrega', () => {
    render(
      <Button loading loadingText="Enviando...">
        Enviar
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Enviando...' })).toBeInTheDocument();
    expect(screen.queryByText('Enviar')).not.toBeInTheDocument();
  });

  it('ignora cliques sintéticos disparados enquanto loading (guarda anti duplo-clique)', () => {
    const onClick = jest.fn();
    render(
      <Button loading onClick={onClick}>
        Sacar
      </Button>,
    );

    // Evento disparado programaticamente contorna o atributo `disabled`;
    // a guarda no handler é a última barreira contra ação duplicada.
    screen
      .getByRole('button', { name: 'Sacar' })
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it.each(['primary', 'secondary', 'danger', 'ghost'] as const)(
    'renderiza a variante %s',
    (variant) => {
      render(<Button variant={variant}>Ação</Button>);

      expect(screen.getByRole('button', { name: 'Ação' })).toBeInTheDocument();
    },
  );

  it.each(['sm', 'md', 'lg'] as const)('renderiza o tamanho %s', (size) => {
    render(<Button size={size}>Ação</Button>);

    expect(screen.getByRole('button', { name: 'Ação' })).toBeInTheDocument();
  });

  it('aplica className extra e fullWidth', () => {
    render(
      <Button fullWidth className="mt-4">
        Ação
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Ação' });
    expect(button).toHaveClass('w-full');
    expect(button).toHaveClass('mt-4');
  });
});
