import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { CurrentClubeContext } from '../types/current-clube.type';

/** Extrai `request.clube`, populado pelo `ClubeMembershipGuard`. Só use em rotas com `:clubeId` e esse guard. */
export const CurrentClube = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentClubeContext => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { clube: CurrentClubeContext }>();
    return request.clube;
  },
);
