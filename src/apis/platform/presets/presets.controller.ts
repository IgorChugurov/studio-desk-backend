import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiError } from '../../../common/errors/api-error.js';
import {
  presetCreateBody,
  presetPatchBody,
} from '../../../common/organization-config.js';
import {
  ZodBody,
  ZodQuery,
} from '../../../common/validation/zod.decorators.js';
import { PresetsService } from './presets.service.js';

const listQuery = z.object({
  currentPage: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(15),
  search: z.string().trim().optional(),
  sortBy: z.enum(['createdAt', 'name']).default('createdAt'),
  order: z.enum(['ASC', 'DESC']).default('DESC'),
});

@Controller('presets')
export class PresetsController {
  constructor(private readonly presets: PresetsService) {}

  @Get()
  list(@ZodQuery(listQuery) query: z.infer<typeof listQuery>) {
    return this.presets.list({
      ...query,
      ...(query.search ? { search: query.search } : {}),
    });
  }

  @Post()
  @ApiResponse({ status: 201 })
  create(@ZodBody(presetCreateBody) body: z.infer<typeof presetCreateBody>) {
    return this.presets.create(body);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.presets.get(parseId(id));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @ZodBody(presetPatchBody) body: z.infer<typeof presetPatchBody>,
  ) {
    return this.presets.update(parseId(id), body);
  }

  @Post(':id/duplicate')
  @ApiResponse({ status: 201 })
  duplicate(@Param('id') id: string) {
    return this.presets.duplicate(parseId(id));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.presets.remove(parseId(id));
  }
}

function parseId(id: string) {
  if (!z.uuid().safeParse(id).success) {
    throw ApiError.notFound('Preset not found');
  }
  return id;
}
