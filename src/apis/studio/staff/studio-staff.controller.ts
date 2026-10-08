import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiError } from '../../../common/errors/api-error.js';
import { emailField } from '../../../common/validation/fields.js';
import {
  ZodBody,
  ZodQuery,
} from '../../../common/validation/zod.decorators.js';
import type { StudioRequest } from '../studio-auth.guard.js';
import { StudioStaffService } from './studio-staff.service.js';

const roleField = z.enum(['administrator', 'accountant'], {
  error: 'Choose a role',
});

const addBody = z.object({
  email: emailField,
  role: roleField,
});

const roleBody = z.object({ role: roleField });

const listQuery = z.object({
  currentPage: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(15),
  search: z.string().trim().optional(),
  sortBy: z.enum(['createdAt', 'email']).default('createdAt'),
  order: z.enum(['ASC', 'DESC']).default('DESC'),
});

@Controller('staff')
export class StudioStaffController {
  constructor(private readonly staff: StudioStaffService) {}

  @Get()
  list(
    @Req() request: StudioRequest,
    @ZodQuery(listQuery) query: z.infer<typeof listQuery>,
  ) {
    return this.staff.list(sessionOf(request), query);
  }

  @Post()
  @ApiResponse({ status: 201 })
  @ApiResponse({
    status: 409,
    description: 'STAFF_ALREADY_ADDED or EMAIL_IS_OWNER',
  })
  add(
    @Req() request: StudioRequest,
    @ZodBody(addBody) body: z.infer<typeof addBody>,
  ) {
    return this.staff.add(sessionOf(request), body);
  }

  @Get(':id')
  one(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.staff.get(sessionOf(request), parseId(id));
  }

  @Patch(':id')
  changeRole(
    @Req() request: StudioRequest,
    @Param('id') id: string,
    @ZodBody(roleBody) body: z.infer<typeof roleBody>,
  ) {
    return this.staff.changeRole(sessionOf(request), parseId(id), body.role);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() request: StudioRequest, @Param('id') id: string) {
    return this.staff.remove(sessionOf(request), parseId(id));
  }
}

function sessionOf(request: StudioRequest) {
  const session = request.studioSession;
  if (!session) throw ApiError.unauthorized();
  return session;
}

function parseId(id: string) {
  if (!z.uuid().safeParse(id).success) {
    throw ApiError.notFound('Staff member not found');
  }
  return id;
}
