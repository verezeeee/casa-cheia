import { Matches } from 'class-validator';

/** Ingresso num clube existente por código (`POST /clubes/entrar`). */
export class JoinClubeDto {
  /** 6 dígitos, gerado por `ClubService.generateJoinCode` na criação do clube. */
  @Matches(/^\d{6}$/, { message: 'code deve ter exatamente 6 dígitos.' })
  code!: string;
}
