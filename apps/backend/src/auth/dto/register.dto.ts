import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Corpo de `POST /auth/register`. Espelha `RegisterRequest` do frontend. */
export class RegisterDto {
  @IsEmail()
  email!: string;

  /**
   * Mínimo 8 caracteres — o suficiente para eliminar senhas triviais sem
   * impor regras de composição (maiúscula/número/símbolo) que a OWASP
   * Authentication Cheat Sheet recomenda evitar: elas levam usuários a
   * padrões previsíveis ("Senha123!") em vez de aumentar entropia real.
   */
  @IsString()
  @MinLength(8)
  @MaxLength(72) // argon2/bcrypt truncam silenciosamente acima disso.
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  /** CPF (somente dígitos). Opcional no cadastro — ver `User.document`. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/, {
    message: 'document deve conter exatamente 11 dígitos (CPF).',
  })
  document?: string;
}
