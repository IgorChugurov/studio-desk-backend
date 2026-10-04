import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../../common/errors/api-error.js';
import { AuthService } from './auth/auth.service.js';

/** Accepts a platform access token whose session is still live. */
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token || !(await this.auth.authenticateAccessToken(token))) {
      throw ApiError.unauthorized();
    }
    return true;
  }
}
