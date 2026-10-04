import { Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiError } from '../../../common/errors/api-error.js';
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
import { StudiosService } from './studios.service.js';

const createBody = z.object({
  name: studioNameField,
  subdomain: subdomainField,
  customDomain: customDomainField.optional(),
  owner: z.object({ email: emailField }),
});

const updateBody = createBody.partial();

const listQuery = z.object({
  currentPage: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(15),
  search: z.string().trim().optional(),
  sortBy: z.literal('createdAt').default('createdAt'),
  order: z.enum(['ASC', 'DESC']).default('DESC'),
  status: z.enum(['active', 'deactivated']).default('active'),
});

@Controller('studios')
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
    });
  }
}

function parseId(id: string) {
  if (!z.uuid().safeParse(id).success) {
    throw ApiError.notFound('Studio not found');
  }
  return id;
}
