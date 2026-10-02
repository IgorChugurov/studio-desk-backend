import { HttpException } from '@nestjs/common';

/** Shared error codes. Feature codes are defined in the feature briefs. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/** Codes of a single field error inside `errors`. */
export const FieldErrorCode = {
  REQUIRED: 'REQUIRED',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_VALUE: 'INVALID_VALUE',
  TOO_SMALL: 'TOO_SMALL',
  TOO_BIG: 'TOO_BIG',
  INVALID: 'INVALID',
} as const;

export interface FieldError {
  code: string;
  field: string;
  message: string;
}

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  field?: string;
  errors?: FieldError[];
}

/** The only exception type that features throw to report an API error. */
export class ApiError extends HttpException {
  constructor(readonly body: ApiErrorBody) {
    super(body, body.statusCode);
  }

  static unauthorized(message = 'Authentication required') {
    return new ApiError({
      statusCode: 401,
      code: ErrorCode.UNAUTHORIZED,
      message,
    });
  }

  static forbidden(message = 'Access denied') {
    return new ApiError({
      statusCode: 403,
      code: ErrorCode.FORBIDDEN,
      message,
    });
  }

  static notFound(message = 'Not found') {
    return new ApiError({
      statusCode: 404,
      code: ErrorCode.NOT_FOUND,
      message,
    });
  }

  static validation(errors: FieldError[]) {
    return new ApiError({
      statusCode: 400,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Validation failed',
      errors,
    });
  }
}
