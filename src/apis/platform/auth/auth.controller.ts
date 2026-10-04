import {
  Controller,
  HttpCode,
  type RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common';
import { Post } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../../../common/auth/public.decorator.js';
import { ApiError } from '../../../common/errors/api-error.js';
import { ZodBody } from '../../../common/validation/zod.decorators.js';
import { AuthService } from './auth.service.js';
import { clearRefreshCookie, readCookie, setRefreshCookie } from './cookies.js';
import { REFRESH_COOKIE } from './tokens.js';

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid e-mail address' }));

const codeRequest = z.object({ email: emailField });
const signInRequest = z.object({
  email: emailField,
  code: z.string().regex(/^\d{6}$/, { error: 'Enter the 6-digit code' }),
});

@Controller('auth')
@Public()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('code')
  @HttpCode(200)
  @ApiResponse({ status: 200, description: 'codeExpiresIn, resendAvailableIn' })
  @ApiResponse({ status: 429, description: 'RESEND_TOO_EARLY' })
  requestCode(@ZodBody(codeRequest) body: z.infer<typeof codeRequest>) {
    return this.auth.requestCode(body.email);
  }

  @Post('sign-in')
  @HttpCode(200)
  @ApiResponse({ status: 200, description: 'accessToken, user' })
  @ApiResponse({ status: 400, description: 'CODE_EXPIRED or INVALID_CODE' })
  @ApiResponse({ status: 429, description: 'TOO_MANY_ATTEMPTS' })
  async signIn(
    @ZodBody(signInRequest) body: z.infer<typeof signInRequest>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.signIn(body.email, body.code);
    setRefreshCookie(response, result.refreshToken);
    return {
      accessToken: result.accessToken,
      accessTokenExpiresIn: result.accessTokenExpiresIn,
      user: result.user,
    };
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiResponse({ status: 200, description: 'accessToken, user' })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED or SESSION_EXPIRED' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    requireRequestedWith(request);
    const cookie = readCookie(request.headers.cookie, REFRESH_COOKIE);
    if (!cookie) {
      throw ApiError.unauthorized();
    }
    try {
      const result = await this.auth.refresh(cookie);
      setRefreshCookie(response, result.refreshToken);
      return {
        accessToken: result.accessToken,
        accessTokenExpiresIn: result.accessTokenExpiresIn,
        user: result.user,
      };
    } catch (error) {
      clearRefreshCookie(response);
      throw error;
    }
  }

  @Post('sign-out')
  @HttpCode(204)
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  async signOut(
    @Req() request: RawBodyRequest<Request>,
    @Res({ passthrough: true }) response: Response,
  ) {
    requireRequestedWith(request);
    await this.auth.signOut(readCookie(request.headers.cookie, REFRESH_COOKIE));
    clearRefreshCookie(response);
  }
}

function requireRequestedWith(request: Request) {
  const value = request.headers['x-requested-with'];
  if (typeof value !== 'string' || value.length === 0) {
    throw ApiError.forbidden();
  }
}
