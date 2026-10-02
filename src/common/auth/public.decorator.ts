import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';

export const IS_PUBLIC_KEY = 'isPublic';
export const OPENAPI_PUBLIC_EXTENSION = 'x-public';

/** Marks a route (or a whole controller) as open without a token. */
export const Public = () =>
  applyDecorators(
    SetMetadata(IS_PUBLIC_KEY, true),
    ApiExtension(OPENAPI_PUBLIC_EXTENSION, true),
  );
