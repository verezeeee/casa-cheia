import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function createHost(url = '/api/health', method = 'GET') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = { url, method };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it('formata uma HttpException padronizando statusCode, message, timestamp e path', () => {
    const { host, status, json } = createHost('/api/wallets/123', 'POST');

    filter.catch(new BadRequestException('payload inválido'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const payload = json.mock.calls[0][0];
    expect(payload.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(payload.message).toBe('payload inválido');
    expect(payload.path).toBe('/api/wallets/123');
    expect(typeof payload.timestamp).toBe('string');
    expect(() => new Date(payload.timestamp)).not.toThrow();
  });

  it('mapeia erros não-HTTP para 500 sem vazar stack trace no payload', () => {
    const { host, status, json } = createHost();

    filter.catch(new Error('algo explodiu internamente'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const payload = json.mock.calls[0][0];
    expect(payload.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(payload.message).toBe('Erro interno do servidor.');
    expect(payload).not.toHaveProperty('stack');
  });

  it('preserva a lista de mensagens de validação do class-validator/ValidationPipe', () => {
    const { host, json } = createHost();

    filter.catch(
      new BadRequestException({
        message: ['campo x é obrigatório', 'campo y deve ser positivo'],
        error: 'Bad Request',
      }),
      host,
    );

    const payload = json.mock.calls[0][0];
    expect(payload.message).toEqual([
      'campo x é obrigatório',
      'campo y deve ser positivo',
    ]);
    expect(payload.error).toBe('Bad Request');
  });
});
