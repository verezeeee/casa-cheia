import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * ADMIN inscrevendo um jogador SEM CADASTRO NO CLUBE — só nome e telefone.
 * Ver `TournamentService.registerGuestEntry`: cria uma conta `User` mínima
 * (e-mail sintético, `isGuest: true`) + `ClubeMembership` (`PLAYER`/`ACTIVE`)
 * + `Wallet` na mesma transação da inscrição — mesmo padrão de
 * `SitGuestAtTableDto` (`TableService.sitGuestAtTable`), só que aqui o buy-in
 * é o do TORNEIO (`Tournament.buyIn` + `fee` [+ `staffBonusCost`]), não um
 * valor escolhido pelo admin.
 */
export class RegisterGuestEntryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  /** Somente dígitos: DDD + número (10 ou 11 dígitos). */
  @Matches(/^\d{10,11}$/, {
    message: 'phone deve ter DDD + número, somente dígitos (10 ou 11 dígitos).',
  })
  phone!: string;

  /**
   * Opção pelo bônus de staff — mesma semântica de
   * `RegisterEntryDto.staffBonus`.
   */
  @IsOptional()
  @IsBoolean()
  staffBonus?: boolean;
}
