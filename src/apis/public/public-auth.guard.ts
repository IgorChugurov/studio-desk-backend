import { type CanActivate, Injectable } from '@nestjs/common';
import { ApiError } from '../../common/errors/api-error.js';

/** Token check of the public API. Until client sign-in exists, denies all. */
@Injectable()
export class PublicAuthGuard implements CanActivate {
  canActivate(): boolean {
    throw ApiError.unauthorized();
  }
}
