import { type CanActivate, Injectable } from '@nestjs/common';
import { ApiError } from '../../common/errors/api-error.js';

/** Token check of the studio admin API. Until sign-in exists, denies all. */
@Injectable()
export class StudioAuthGuard implements CanActivate {
  canActivate(): boolean {
    throw ApiError.unauthorized();
  }
}
