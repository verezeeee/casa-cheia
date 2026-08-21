import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Input } from './input';

describe('Input', () => {
  it('associa o label ao input e não marca erro por padrão', () => {
    render(<Input label="Valor do depósito" />);

    const input = screen.getByLabelText('Valor do depósito');
    expect(input).toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('liga a mensagem de erro ao input via aria-describedby', () => {
    render(<Input label="CPF" error="CPF inválido" />);

    const input = screen.getByLabelText('CPF');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    const errorElement = document.getElementById(describedBy as string);
    expect(errorElement).toHaveTextContent('CPF inválido');
    expect(screen.getByRole('alert')).toHaveTextContent('CPF inválido');
  });

  it('liga a dica ao input via aria-describedby quando não há erro', () => {
    render(<Input label="Chave PIX" hint="Use CPF, e-mail ou telefone" />);

    const input = screen.getByLabelText('Chave PIX');
    const describedBy = input.getAttribute('aria-describedby') as string;

    expect(document.getElementById(describedBy)).toHaveTextContent('Use CPF, e-mail ou telefone');
  });

  it('prioriza o erro sobre a dica', () => {
    render(<Input label="Chave PIX" hint="Use CPF, e-mail ou telefone" error="Chave inválida" />);

    expect(screen.queryByText('Use CPF, e-mail ou telefone')).not.toBeInTheDocument();

    const input = screen.getByLabelText('Chave PIX');
    const describedBy = input.getAttribute('aria-describedby') as string;
    expect(document.getElementById(describedBy)).toHaveTextContent('Chave inválida');
  });

  it('respeita id e aria-describedby informados por fora', () => {
    render(
      <>
        <span id="externo">Ajuda externa</span>
        <Input label="Apelido" id="apelido" aria-describedby="externo" />
      </>,
    );

    const input = screen.getByLabelText('Apelido');
    expect(input).toHaveAttribute('id', 'apelido');
    expect(input.getAttribute('aria-describedby')).toContain('externo');
  });

  it('encaminha ref (compatível com register() do react-hook-form)', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input label="Valor" ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('propaga estado desabilitado e eventos de digitação', () => {
    const onChange = jest.fn();
    const { rerender } = render(<Input label="Valor" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: '100' } });
    expect(onChange).toHaveBeenCalledTimes(1);

    rerender(<Input label="Valor" disabled />);
    expect(screen.getByLabelText('Valor')).toBeDisabled();
  });
});
