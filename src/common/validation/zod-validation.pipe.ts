import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import {
  ApiError,
  type FieldError,
  FieldErrorCode,
} from '../errors/api-error.js';

/** Validates a request part with a Zod schema; unknown keys are stripped. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw ApiError.validation(
      result.error.issues.map((issue) => toFieldError(issue, value)),
    );
  }
}

function toFieldError(issue: z.core.$ZodIssue, input: unknown): FieldError {
  return {
    code: fieldErrorCode(issue, input),
    field: issue.path.map(String).join('.'),
    message: issue.message,
  };
}

function valueAt(input: unknown, path: PropertyKey[]): unknown {
  let current = input;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function fieldErrorCode(issue: z.core.$ZodIssue, input: unknown): string {
  switch (issue.code) {
    case 'invalid_type':
      return valueAt(input, issue.path) === undefined
        ? FieldErrorCode.REQUIRED
        : FieldErrorCode.INVALID_TYPE;
    case 'invalid_format':
      return FieldErrorCode.INVALID_FORMAT;
    case 'invalid_value':
      return FieldErrorCode.INVALID_VALUE;
    case 'too_small':
      return FieldErrorCode.TOO_SMALL;
    case 'too_big':
      return FieldErrorCode.TOO_BIG;
    default: {
      if (
        issue.code === 'custom' &&
        typeof issue.params?.fieldCode === 'string'
      ) {
        return issue.params.fieldCode;
      }
      return FieldErrorCode.INVALID;
    }
  }
}
