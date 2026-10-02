import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = await NestFactory.create(AppModule);
configureApp(app);
await app.listen(env.PORT);
