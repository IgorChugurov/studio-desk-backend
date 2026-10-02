import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';

type Imports = NonNullable<
  Parameters<typeof Test.createTestingModule>[0]['imports']
>;

/** The real application, optionally with extra test-only modules. */
export async function createTestApp(
  options: {
    imports?: Imports;
    override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  } = {},
): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    imports: [AppModule, ...(options.imports ?? [])],
  });
  if (options.override) builder = options.override(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}
