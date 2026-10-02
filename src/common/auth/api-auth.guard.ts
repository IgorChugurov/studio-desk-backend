import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PlatformAuthGuard } from '../../apis/platform/platform-auth.guard.js';
import { PublicAuthGuard } from '../../apis/public/public-auth.guard.js';
import { StudioAuthGuard } from '../../apis/studio/studio-auth.guard.js';
import { ApiError } from '../errors/api-error.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

/**
 * Global guard: open routes pass; every other route goes to the guard of the
 * API it belongs to (by path). A closed route outside the three APIs is denied.
 */
@Injectable()
export class ApiAuthGuard implements CanActivate {
  private readonly guards: ReadonlyArray<[prefix: string, guard: CanActivate]>;

  constructor(
    private readonly reflector: Reflector,
    platform: PlatformAuthGuard,
    studio: StudioAuthGuard,
    publicApi: PublicAuthGuard,
  ) {
    this.guards = [
      ['/api/platform', platform],
      ['/api/studio', studio],
      ['/api/public', publicApi],
    ];
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const { path } = context.switchToHttp().getRequest<Request>();
    const match = this.guards.find(
      ([prefix]) => path === prefix || path.startsWith(`${prefix}/`),
    );
    if (!match) throw ApiError.unauthorized();
    return match[1].canActivate(context);
  }
}
