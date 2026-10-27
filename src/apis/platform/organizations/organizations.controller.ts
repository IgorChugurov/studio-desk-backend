import {
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { ApiError } from '../../../common/errors/api-error.js';
import { organizationSectionsField } from '../../../common/organization-config.js';
import {
  customDomainField,
  emailField,
  studioNameField,
  subdomainField,
} from '../../../common/validation/fields.js';
import {
  ZodBody,
  ZodQuery,
} from '../../../common/validation/zod.decorators.js';
import type { PlatformRequest } from '../platform-auth.guard.js';
import { StudiosService } from './organizations.service.js';

const presetIdField = z.any().superRefine((value, ctx) => {
  if (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'Select a preset',
      params: { fieldCode: 'REQUIRED' },
    });
    return;
  }
  if (typeof value !== 'string' || !z.uuid().safeParse(value.trim()).success) {
    ctx.addIssue({
      code: 'custom',
      message: 'Select a preset',
      params: { fieldCode: 'INVALID_VALUE' },
    });
  }
});

const createBody = z.object({
  name: studioNameField,
  subdomain: subdomainField,
  customDomain: customDomainField.optional(),
  owner: z.object({ email: emailField }),
  presetId: presetIdField,
});

const updateBody = createBody.omit({ presetId: true }).partial().extend({
  sections: organizationSectionsField.optional(),
});

const listQuery = z.object({
  currentPage: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(15),
  search: z.string().trim().optional(),
  sortBy: z.literal('createdAt').default('createdAt'),
  order: z.enum(['ASC', 'DESC']).default('DESC'),
  status: z.enum(['active', 'deactivated']).default('active'),
});

@Controller('organizations')
export class StudiosController {
  constructor(private readonly studios: StudiosService) {}

  @Get()
  list(@ZodQuery(listQuery) query: z.infer<typeof listQuery>) {
    return this.studios.list(query);
  }

  @Post()
  @ApiResponse({ status: 201 })
  create(@ZodBody(createBody) body: z.infer<typeof createBody>) {
    return this.studios.create({
      name: body.name,
      subdomain: body.subdomain,
      customDomain: body.customDomain,
      ownerEmail: body.owner.email,
      presetId: (body.presetId as string).trim(),
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.studios.get(parseId(id));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @ZodBody(updateBody) body: z.infer<typeof updateBody>,
  ) {
    return this.studios.update(parseId(id), {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.subdomain !== undefined ? { subdomain: body.subdomain } : {}),
      ...(body.customDomain !== undefined
        ? { customDomain: body.customDomain }
        : {}),
      ...(body.owner ? { ownerEmail: body.owner.email } : {}),
      ...(body.sections !== undefined ? { sections: body.sections } : {}),
    });
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@Param('id') id: string) {
    return this.studios.setStatus(parseId(id), 'deactivated');
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@Param('id') id: string) {
    return this.studios.setStatus(parseId(id), 'active');
  }

  @Post(':id/impersonate')
  @HttpCode(200)
  impersonate(@Param('id') id: string, @Req() request: Request) {
    const administratorId = (request as PlatformRequest)
      .platformAdministratorId;
    if (!administratorId) throw ApiError.unauthorized();
    return this.studios.impersonate(parseId(id), administratorId);
  }
}

function parseId(id: string) {
  if (!z.uuid().safeParse(id).success) {
    throw ApiError.notFound('Organization not found');
  }
  return id;
}
