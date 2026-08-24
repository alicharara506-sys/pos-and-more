import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import express from 'express';
import { loadEnv } from '@salesmaster/config';
import { AppModule } from './app.module';

async function bootstrap() {
  // Fail fast on a misconfigured environment instead of crashing deep in a request handler.
  const env = loadEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  app.use(helmet());
  app.use(cookieParser());

  // Stripe webhook signature verification needs the raw request body, so
  // this route is exempted from the global JSON parser (must be registered
  // before express.json()).
  app.use('/billing/webhooks/stripe', express.raw({ type: 'application/json' }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true })); // Apple's form_post OAuth callback

  app.enableCors({ origin: env.APP_URL, credentials: true });
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SalesMaster Pro API')
    .setDescription(
      'Multi-tenant POS, CRM, inventory, invoicing, and commerce-integration platform API',
    )
    .setVersion('1.0')
    .addCookieAuth('sm_session')
    .addApiKey({ type: 'apiKey', name: 'X-Tenant-Id', in: 'header' }, 'tenant')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`SalesMaster Pro API listening on :${port} (docs at /docs)`);
}

bootstrap();
