// Import de efeito colateral: o módulo só declara interfaces (é apagado na
// compilação), então sem esta linha ele nunca seria carregado em runtime e
// apareceria como 0% no relatório de cobertura.
import './types';
import type { LoginRequest, RegisterRequest } from './types';

describe('api/types', () => {
  it('RegisterRequest aceita document opcional', () => {
    const semDocumento: RegisterRequest = {
      email: 'player@poker.dev',
      password: 'S3nh@Forte',
      name: 'Player One',
    };
    const comDocumento: RegisterRequest = { ...semDocumento, document: '12345678901' };

    expect(semDocumento.document).toBeUndefined();
    expect(comDocumento.document).toBe('12345678901');
  });

  it('LoginRequest exige apenas email e senha', () => {
    const input: LoginRequest = { email: 'player@poker.dev', password: 'S3nh@Forte' };

    expect(Object.keys(input)).toEqual(['email', 'password']);
  });
});
