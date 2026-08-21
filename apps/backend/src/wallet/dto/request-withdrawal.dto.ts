import { IsIn, IsString, Matches, MinLength } from 'class-validator';

const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

/** Tipos de chave PIX aceitos pelo AbacatePay. */
const PIX_KEY_TYPES = ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM'] as const;

export class RequestWithdrawalDto {
  @Matches(DECIMAL_PATTERN, {
    message: 'amount deve ser um decimal em formato monetário, ex: "50.00".',
  })
  amount!: string;

  @IsString()
  @MinLength(1)
  pixKey!: string;

  @IsIn(PIX_KEY_TYPES)
  pixKeyType!: (typeof PIX_KEY_TYPES)[number];
}
