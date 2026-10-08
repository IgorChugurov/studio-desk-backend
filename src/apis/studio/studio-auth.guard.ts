import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../../common/errors/api-error.js';
import {
  StudioAuthService,
  type StudioSessionInfo,
} from './auth/studio-auth.service.js';

export type StudioRequest = Request & { studioSession?: StudioSessionInfo };

/** Accepts a studio access token whose session is live and belongs to its studio. */
@Injectable()
export class StudioAuthGuard implements CanActivate {
  constructor(private readonly auth: StudioAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StudioRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const session = token
      ? await this.auth.authenticateAccessToken(token)
      : undefined;
    if (!session) throw ApiError.unauthorized();
    request.studioSession = session;
    return true;
  }
}
