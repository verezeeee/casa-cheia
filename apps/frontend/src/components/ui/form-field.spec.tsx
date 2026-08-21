import { render, screen } from '@testing-library/react';
import { FormField } from './form-field';
import { Input } from './input';

describe('FormField', () => {
  it('renderiza label e children', () => {
    render(
      <FormField label="Valor">
        <Input />
      </FormField>,
    );

    expect(screen.getByLabelText('Valor')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('associa o erro ao controle filho via aria-describedby e aria-invalid', () => {
    render(
      <FormField label="Valor do saque" error="Saldo insuficiente">
        <Input />
      </FormField>,
    );

    const input = screen.getByLabelText('Valor do saque');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    const describedBy = input.getAttribute('aria-describedby') as string;
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy)).toHaveTextContent('Saldo insuficiente');
    expect(screen.getByRole('alert')).toHaveTextContent('Saldo insuficiente');
  });

  it('associa a dica ao controle quando não há erro', () => {
    render(
      <FormField label="Chave PIX" hint="Somente chaves do titular">
        <Input />
      </FormField>,
    );

    const input = screen.getByLabelText('Chave PIX');
    const describedBy = input.getAttribute('aria-describedby') as string;

    expect(document.getElementById(describedBy)).toHaveTextContent('Somente chaves do titular');
  });

  it('esconde a dica quando há erro', () => {
    render(
      <FormField label="Chave PIX" hint="Somente chaves do titular" error="Chave inválida">
        <Input />
      </FormField>,
    );

    expect(screen.queryByText('Somente chaves do titular')).not.toBeInTheDocument();
  });

  it('suporta render-prop para controles de terceiros', () => {
    render(
      <FormField label="Método" error="Selecione um método">
        {({ id, describedBy, invalid }) => (
          <select id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined}>
            <option value="pix">PIX</option>
          </select>
        )}
      </FormField>,
    );

    const select = screen.getByLabelText('Método');
    expect(select).toHaveAttribute('aria-invalid', 'true');

    const describedBy = select.getAttribute('aria-describedby') as string;
    expect(document.getElementById(describedBy)).toHaveTextContent('Selecione um método');
  });

  it('usa o htmlFor informado como id do controle', () => {
    render(
      <FormField label="Valor" htmlFor="valor-saque">
        <Input />
      </FormField>,
    );

    expect(screen.getByLabelText('Valor')).toHaveAttribute('id', 'valor-saque');
  });

  it('marca visualmente campos obrigatórios', () => {
    render(
      <FormField label="Valor" required>
        <Input />
      </FormField>,
    );

    expect(screen.getByLabelText(/^Valor/)).toBeInTheDocument();
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
  });
});
