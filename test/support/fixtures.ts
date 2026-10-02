import { Controller, Get, Module, Post } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { z } from 'zod';
import { Public } from '../../src/common/auth/public.decorator.js';
import {
  ZodBody,
  ZodQuery,
} from '../../src/common/validation/zod.decorators.js';

/**
 * Test-only routes inside each API (and one outside all APIs). They exist
 * only in tests, so the guard, validation and error mechanisms can be proven
 * before real features exist.
 */
const echoBody = z.object({
  name: z.string().min(3),
  email: z.email(),
});

const listQuery = z.object({ page: z.coerce.number().int().min(1).optional() });

@Controller('fixture')
class FixtureController {
  @Get('closed')
  closed() {
    return { ok: true };
  }

  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }

  @Public()
  @Post('echo')
  echo(@ZodBody(echoBody) body: z.infer<typeof echoBody>) {
    return body;
  }

  @Public()
  @Get('list')
  list(@ZodQuery(listQuery) query: z.infer<typeof listQuery>) {
    return query;
  }

  @Public()
  @Get('boom')
  boom() {
    throw new Error('secret internal detail: relation "x" does not exist');
  }
}

@Module({ controllers: [FixtureController] })
export class PlatformFixtureModule {}

@Module({ controllers: [FixtureController] })
export class StudioFixtureModule {}

@Module({ controllers: [FixtureController] })
export class PublicFixtureModule {}

@Controller('outside')
class OutsideController {
  @Get('closed')
  closed() {
    return { ok: true };
  }
}

/** A closed route outside the three APIs: must be denied. */
@Module({ controllers: [OutsideController] })
export class OutsideFixtureModule {}

export const fixtureImports = [
  PlatformFixtureModule,
  StudioFixtureModule,
  PublicFixtureModule,
  OutsideFixtureModule,
  RouterModule.register([
    { path: 'platform', module: PlatformFixtureModule },
    { path: 'studio', module: StudioFixtureModule },
    { path: 'public', module: PublicFixtureModule },
  ]),
];
