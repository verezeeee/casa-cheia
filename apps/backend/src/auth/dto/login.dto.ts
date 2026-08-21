import { IsEmail, IsString, MinLength } from 'class-validator';

/** Corpo de `POST /auth/login`. Espelha `LoginRequest` do frontend. */
export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
