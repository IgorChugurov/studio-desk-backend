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
import {
  clearRefreshCookie,
  readCookie,
  requireRequestedWith,
  setRefreshCookie,
} from '../../../common/auth/cookies.js';
import { Public } from '../../../common/auth/public.decorator.js';
import { ApiError } from '../../../common/errors/api-error.js';
import { ZodBody } from '../../../common/validation/zod.decorators.js';
import { emailField } from '../../../common/validation/fields.js';
import { AuthService } from './auth.service.js';
import { PLATFORM_COOKIE } from './platform-cookie.js';

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
    setRefreshCookie(response, PLATFORM_COOKIE, result.refreshToken);
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
    const cookie = readCookie(request.headers.cookie, PLATFORM_COOKIE.name);
    if (!cookie) {
      throw ApiError.unauthorized();
    }
    try {
      const result = await this.auth.refresh(cookie);
      setRefreshCookie(response, PLATFORM_COOKIE, result.refreshToken);
      return {
        accessToken: result.accessToken,
        accessTokenExpiresIn: result.accessTokenExpiresIn,
        user: result.user,
      };
    } catch (error) {
      clearRefreshCookie(response, PLATFORM_COOKIE);
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
    await this.auth.signOut(
      readCookie(request.headers.cookie, PLATFORM_COOKIE.name),
    );
    clearRefreshCookie(response, PLATFORM_COOKIE);
  }
}
