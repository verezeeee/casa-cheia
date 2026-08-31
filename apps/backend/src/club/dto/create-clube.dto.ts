import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Criação de clube por autoatendimento (`POST /clubes`) — quem cria vira
 * `ADMIN` na mesma transação (`ClubService.createClube`). O `joinCode` de
 * ingresso é gerado pelo servidor, nunca informado aqui.
 */
export class CreateClubeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  /** CNPJ (14 dígitos) ou CPF (11 dígitos) do clube, somente dígitos. */
  @Matches(/^\d{11}$|^\d{14}$/, {
    message:
      'document deve ter 11 dígitos (CPF) ou 14 dígitos (CNPJ), sem pontuação.',
  })
  document!: string;
}
