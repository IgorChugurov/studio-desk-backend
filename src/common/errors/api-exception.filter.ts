import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiError, type ApiErrorBody, ErrorCode } from './api-error.js';

const CODE_BY_STATUS: Record<number, string> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
};

/**
 * Turns every error of every API into the shared error format.
 * Internal details (database errors, stack traces) go to the log only.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const body = this.toBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(
        exception instanceof Error
          ? (exception.stack ?? exception.message)
          : exception,
      );
    }
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(body.statusCode)
      .json(body);
  }

  private toBody(exception: unknown): ApiErrorBody {
    if (exception instanceof ApiError) return exception.body;

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      if (statusCode < 500) {
        return {
          statusCode,
          code: CODE_BY_STATUS[statusCode] ?? ErrorCode.BAD_REQUEST,
          message: exception.message,
        };
      }
    }

    return {
      statusCode: 500,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    };
  }
}
