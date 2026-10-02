import {
  type ArgumentsHost,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ApiError } from './api-error.js';
import { ApiExceptionFilter } from './api-exception.filter.js';

function run(exception: unknown) {
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  new ApiExceptionFilter().catch(exception, host);
  return {
    status: response.status.mock.calls[0]?.[0],
    body: response.json.mock.calls[0]?.[0],
  };
}

describe('ApiExceptionFilter', () => {
  let logError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  it('passes ApiError through as is', () => {
    const error = new ApiError({
      statusCode: 409,
      code: 'SUBDOMAIN_TAKEN',
      message: 'Subdomain is already taken',
      field: 'subdomain',
    });
    expect(run(error)).toEqual({ status: 409, body: error.body });
  });

  it('maps Nest HTTP exceptions to shared codes', () => {
    expect(run(new NotFoundException()).body).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    expect(run(new ForbiddenException()).body).toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  it('hides internal details of unknown errors and logs them', () => {
    const result = run(new Error('password=hunter2'));
    expect(result).toEqual({
      status: 500,
      body: {
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
    expect(logError).toHaveBeenCalled();
  });
});
