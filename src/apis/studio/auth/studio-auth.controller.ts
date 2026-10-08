import {
  Controller,
  HttpCode,
  Post,
  type RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common';
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
import { emailField } from '../../../common/validation/fields.js';
import { ZodBody } from '../../../common/validation/zod.decorators.js';
import type { StudioRequest } from '../studio-auth.guard.js';
import {
  type SessionResult,
  StudioAuthService,
} from './studio-auth.service.js';
import { STUDIO_COOKIE } from './studio-cookie.js';

const codeRequest = z.object({ email: emailField });
const signInRequest = z.object({
  email: emailField,
  code: z.string().regex(/^\d{6}$/, { error: 'Enter the 6-digit code' }),
});
const selectStudioRequest = z.object({
  selectionTicket: z.string().min(1),
  studioId: z.uuid(),
});
const switchStudioRequest = z.object({ studioId: z.uuid() });

@Controller('auth')
export class StudioAuthController {
  constructor(private readonly auth: StudioAuthService) {}

  @Public()
  @Post('code')
  @HttpCode(200)
  @ApiResponse({ status: 200, description: 'codeExpiresIn, resendAvailableIn' })
  @ApiResponse({ status: 429, description: 'RESEND_TOO_EARLY' })
  requestCode(@ZodBody(codeRequest) body: z.infer<typeof codeRequest>) {
    return this.auth.requestCode(body.email);
  }

  @Public()
  @Post('sign-in')
  @HttpCode(200)
  @ApiResponse({
    status: 200,
    description:
      'result "signed-in" (session body) or "studio-selection" (selectionTicket, studios)',
  })
  @ApiResponse({ status: 400, description: 'CODE_EXPIRED or INVALID_CODE' })
  @ApiResponse({ status: 429, description: 'TOO_MANY_ATTEMPTS' })
  async signIn(
    @ZodBody(signInRequest) body: z.infer<typeof signInRequest>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const outcome = await this.auth.signIn(body.email, body.code);
    if (outcome.result === 'studio-selection') return outcome;
    const { result, ...session } = outcome;
    setRefreshCookie(response, STUDIO_COOKIE, session.refreshToken);
    return { result, ...sessionBody(session) };
  }

  @Public()
  @Post('select-studio')
  @HttpCode(200)
  @ApiResponse({ status: 200, description: 'session body' })
  @ApiResponse({ status: 400, description: 'INVALID_SELECTION_TICKET' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  async selectStudio(
    @ZodBody(selectStudioRequest) body: z.infer<typeof selectStudioRequest>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.selectStudio(
      body.selectionTicket,
      body.studioId,
    );
    setRefreshCookie(response, STUDIO_COOKIE, session.refreshToken);
    return sessionBody(session);
  }

  @Post('switch-studio')
  @HttpCode(200)
  @ApiResponse({ status: 200, description: 'session body of the new studio' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  async switchStudio(
    @Req() request: StudioRequest,
    @ZodBody(switchStudioRequest) body: z.infer<typeof switchStudioRequest>,
    @Res({ passthrough: true }) response: Response,
  ) {
    requireRequestedWith(request);
    const current = request.studioSession;
    if (!current) throw ApiError.unauthorized();
    const session = await this.auth.switchStudio(current, body.studioId);
    setRefreshCookie(response, STUDIO_COOKIE, session.refreshToken);
    return sessionBody(session);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiResponse({ status: 200, description: 'session body' })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED or SESSION_EXPIRED' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    requireRequestedWith(request);
    const cookie = readCookie(request.headers.cookie, STUDIO_COOKIE.name);
    if (!cookie) throw ApiError.unauthorized();
    try {
      const session = await this.auth.refresh(cookie);
      setRefreshCookie(response, STUDIO_COOKIE, session.refreshToken);
      return sessionBody(session);
    } catch (error) {
      clearRefreshCookie(response, STUDIO_COOKIE);
      throw error;
    }
  }

  @Public()
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
      readCookie(request.headers.cookie, STUDIO_COOKIE.name),
    );
    clearRefreshCookie(response, STUDIO_COOKIE);
  }
}

/** The body of a session answer: everything except the refresh token (it is in the cookie). */
function sessionBody(session: SessionResult) {
  return {
    accessToken: session.accessToken,
    accessTokenExpiresIn: session.accessTokenExpiresIn,
    user: session.user,
    studio: session.studio,
  };
}
