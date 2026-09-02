import { maskCnpj, maskCpf, maskCpfOuCnpj, maskPhone, onlyDigits } from './masks';

describe('onlyDigits', () => {
  it('remove tudo que não é dígito', () => {
    expect(onlyDigits('123.456.789-01')).toBe('12345678901');
  });

  it('trunca ao máximo informado', () => {
    expect(onlyDigits('123456789012345', 11)).toBe('12345678901');
  });

  it('sem máximo, não trunca', () => {
    expect(onlyDigits('123456789012345')).toBe('123456789012345');
  });
});

describe('maskCpf', () => {
  it('formata progressivamente enquanto digita', () => {
    expect(maskCpf('1')).toBe('1');
    expect(maskCpf('123')).toBe('123');
    expect(maskCpf('1234')).toBe('123.4');
    expect(maskCpf('123456789')).toBe('123.456.789');
    expect(maskCpf('12345678901')).toBe('123.456.789-01');
  });

  it('ignora não-dígitos e trunca em 11 dígitos', () => {
    expect(maskCpf('123.456.789-01999')).toBe('123.456.789-01');
  });
});

describe('maskCnpj', () => {
  it('formata um CNPJ completo', () => {
    expect(maskCnpj('12345678000199')).toBe('12.345.678/0001-99');
  });

  it('trunca em 14 dígitos', () => {
    expect(maskCnpj('123456780001999999')).toBe('12.345.678/0001-99');
  });
});

describe('maskCpfOuCnpj', () => {
  it('usa máscara de CPF até 11 dígitos', () => {
    expect(maskCpfOuCnpj('12345678901')).toBe('123.456.789-01');
  });

  it('passa a usar máscara de CNPJ a partir do 12º dígito', () => {
    expect(maskCpfOuCnpj('123456789012')).toBe('12.345.678/9012');
    expect(maskCpfOuCnpj('12345678000199')).toBe('12.345.678/0001-99');
  });
});

describe('maskPhone', () => {
  it('formata celular (11 dígitos)', () => {
    expect(maskPhone('11988887777')).toBe('(11) 98888-7777');
  });

  it('formata fixo (10 dígitos)', () => {
    expect(maskPhone('1133334444')).toBe('(11) 3333-4444');
  });

  it('formata progressivamente enquanto digita', () => {
    expect(maskPhone('11')).toBe('(11');
    expect(maskPhone('1198')).toBe('(11) 98');
  });

  it('trunca em 11 dígitos', () => {
    expect(maskPhone('119888877779999')).toBe('(11) 98888-7777');
  });
});
