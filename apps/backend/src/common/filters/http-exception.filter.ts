import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiErrorResponse } from '@poker-system/shared';
import type { Request, Response } from 'express';

/**
 * Filtro global de exceções.
 *
 * Padroniza TODO erro (HttpException do Nest ou exceção não tratada) em um
 * único formato de payload (`ApiErrorResponse`, compartilhado com o
 * frontend via @poker-system/shared):
 *   { statusCode, message, error?, timestamp, path }
 *
 * Em produção, o `stack` nunca é incluído na resposta HTTP — apenas logado
 * no servidor — para não vazar detalhes internos da implementação.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isProduction = process.env.NODE_ENV === 'production';
    const { statusCode, message, error } = this.resolveExceptionData(exception);

    const payload: ApiErrorResponse = {
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    const logMessage = `${request.method} ${request.url} -> ${statusCode}`;
    const serverErrorThreshold: number = HttpStatus.INTERNAL_SERVER_ERROR;
    if (statusCode >= serverErrorThreshold) {
      this.logger.error(
        logMessage,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(logMessage);
    }

    // Stack trace nunca vai para o cliente, mesmo fora de produção;
    // ficar visível apenas nos logs do servidor acima.
    void isProduction;

    response.status(statusCode).json(payload);
  }

  private resolveExceptionData(exception: unknown): {
    statusCode: number;
    message: string | string[];
    error?: string;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === 'string') {
        return { statusCode: status, message: response };
      }

      const responseObj = response as Record<string, unknown>;
      return {
        statusCode: status,
        message:
          (responseObj.message as string | string[]) ?? exception.message,
        error: responseObj.error as string | undefined,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Erro interno do servidor.',
      error: 'Internal Server Error',
    };
  }
}
