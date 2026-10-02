import { z } from 'zod';
import { ApiError } from '../errors/api-error.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(
    z.object({
      name: z.string().max(5),
      age: z.number().int().min(18),
      email: z.email(),
      role: z.enum(['owner', 'staff']),
      nested: z.object({ value: z.string() }).optional(),
    }),
  );

  function fieldErrors(input: unknown) {
    try {
      pipe.transform(input);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      return (error as ApiError).body.errors?.map(({ code, field }) => ({
        code,
        field,
      }));
    }
    throw new Error('expected a validation error');
  }

  it('returns parsed data and drops unknown keys', () => {
    expect(
      pipe.transform({
        name: 'Ann',
        age: 20,
        email: 'a@b.co',
        role: 'owner',
        extra: 1,
      }),
    ).toEqual({ name: 'Ann', age: 20, email: 'a@b.co', role: 'owner' });
  });

  it('maps Zod issues to field error codes', () => {
    expect(
      fieldErrors({
        name: 'too long name',
        age: 'twenty',
        email: 'nope',
        role: 'admin',
        nested: { value: 1 },
      }),
    ).toEqual([
      { code: 'TOO_BIG', field: 'name' },
      { code: 'INVALID_TYPE', field: 'age' },
      { code: 'INVALID_FORMAT', field: 'email' },
      { code: 'INVALID_VALUE', field: 'role' },
      { code: 'INVALID_TYPE', field: 'nested.value' },
    ]);
  });

  it('reports missing fields as REQUIRED and small numbers as TOO_SMALL', () => {
    expect(fieldErrors({ name: 'Ann', age: 10, role: 'owner' })).toEqual([
      { code: 'TOO_SMALL', field: 'age' },
      { code: 'REQUIRED', field: 'email' },
    ]);
  });
});
