import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DECIMAL_PATTERN } from './sit-at-table.dto';

/**
 * Admin senta um jogador SEM CADASTRO (walk-in) numa mesa — só nome e
 * telefone, sem e-mail/senha. Ver `TableService.sitGuestAtTable`: cria uma
 * conta `User` mínima (e-mail sintético, `isGuest: true`) na mesma transação
 * do buy-in.
 */
export class SitGuestAtTableDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  seatNumber!: number;

  @Matches(DECIMAL_PATTERN, {
    message: 'buyInAmount deve ser um decimal monetário, ex: "100.00".',
  })
  buyInAmount!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  /** Somente dígitos: DDD + número (10 ou 11 dígitos). */
  @Matches(/^\d{10,11}$/, {
    message: 'phone deve ter DDD + número, somente dígitos (10 ou 11 dígitos).',
  })
  phone!: string;
}
