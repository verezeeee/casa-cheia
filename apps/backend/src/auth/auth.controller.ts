import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { AuthTokensResponse, SessionUser } from '@poker-system/shared';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SENSITIVE_ROUTE_THROTTLE } from '../common/http/rate-limits';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedUser } from './types/authenticated-user.type';

/** Nome do cookie httpOnly que carrega o refresh token. */
const REFRESH_TOKEN_COOKIE = 'refresh_token';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<SessionUser> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(SENSITIVE_ROUTE_THROTTLE)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokensResponse> {
    const session = await this.authService.login(dto, requestMetadata(req));
    this.setRefreshCookie(
      res,
      session.refreshToken,
      session.refreshTokenExpiresAt,
    );
    return session.tokens;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokensResponse> {
    const rawToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    if (!rawToken) {
      this.clearRefreshCookie(res);
      throw new UnauthorizedException('Refresh token ausente.');
    }

    const session = await this.authService.refresh(
      rawToken,
      requestMetadata(req),
    );
    this.setRefreshCookie(
      res,
      session.refreshToken,
      session.refreshTokenExpiresAt,
    );
    return session.tokens;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const rawToken = req.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    await this.authService.logout(rawToken);
    this.clearRefreshCookie(res);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser): Promise<SessionUser> {
    return this.authService.me(user.id);
  }

  /** `/{apiPrefix}/auth` — o cookie só é enviado pelo browser nas próprias rotas de auth. */
  private cookiePath(): string {
    return `/${this.configService.get<string>('app.apiPrefix') ?? 'api'}/auth`;
  }

  private setRefreshCookie(
    res: Response,
    token: string,
    expiresAt: Date,
  ): void {
    res.cookie(REFRESH_TOKEN_COOKIE, token, {
      httpOnly: true,
      secure: this.configService.get<boolean>('security.cookieSecure') ?? true,
      sameSite: 'lax',
      domain: this.configService.get<string>('security.cookieDomain'),
      path: this.cookiePath(),
      expires: expiresAt,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_TOKEN_COOKIE, {
      httpOnly: true,
      secure: this.configService.get<boolean>('security.cookieSecure') ?? true,
      sameSite: 'lax',
      domain: this.configService.get<string>('security.cookieDomain'),
      path: this.cookiePath(),
    });
  }
}

function requestMetadata(req: Request): { userAgent?: string; ip?: string } {
  return {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  };
}
