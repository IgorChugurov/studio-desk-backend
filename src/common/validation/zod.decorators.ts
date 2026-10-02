import { Body, Query } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

type JsonSchema = Record<string, unknown>;

function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, {
    io,
  }) as JsonSchema;
  return rest;
}

function methodDescriptor(target: object, key: string | symbol | undefined) {
  if (key === undefined)
    throw new Error('Zod decorators are for handler parameters');
  return [key, Object.getOwnPropertyDescriptor(target, key)!] as const;
}

/** Validated request body; the schema also goes into the OpenAPI document. */
export function ZodBody(schema: z.ZodType): ParameterDecorator {
  return (target, key, index) => {
    Body(new ZodValidationPipe(schema))(target, key, index);
    const [name, descriptor] = methodDescriptor(target, key);
    ApiBody({ schema: jsonSchema(schema, 'input') })(target, name, descriptor);
  };
}

/** Validated query string; each property becomes an OpenAPI query parameter. */
export function ZodQuery(schema: z.ZodObject): ParameterDecorator {
  return (target, key, index) => {
    Query(new ZodValidationPipe(schema))(target, key, index);
    const [name, descriptor] = methodDescriptor(target, key);
    for (const [field, fieldSchema] of Object.entries(schema.shape)) {
      ApiQuery({
        name: field,
        required: !(fieldSchema as z.ZodType).safeParse(undefined).success,
        schema: jsonSchema(fieldSchema as z.ZodType, 'input'),
      })(target, name, descriptor);
    }
  };
}
