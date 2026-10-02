import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_ROUTES } from '../../app.module.js';

/**
 * One OpenAPI document per API:
 *   page  /api/<api>/docs
 *   JSON  /api/<api>/docs/json
 * Enabled only outside production (see 03-architecture/api-conventions.md).
 */
export function setupOpenApi(app: INestApplication) {
  for (const { path, module } of API_ROUTES) {
    const config = new DocumentBuilder()
      .setTitle(`StudioDesk ${path} API`)
      .setVersion('0.0.1')
      .build();
    const document = SwaggerModule.createDocument(app, config, {
      include: [module],
    });
    SwaggerModule.setup(`api/${path}/docs`, app, document, {
      jsonDocumentUrl: `api/${path}/docs/json`,
      yamlDocumentUrl: undefined,
    });
  }
}
