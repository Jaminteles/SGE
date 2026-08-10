import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.useLogger(app.get(Logger));

  // Cabeçalhos de segurança HTTP (ERS §11).
  app.use(helmet());

  // CORS restrito às origens configuradas.
  const origins = config
    .get<string>('CORS_ORIGINS', '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length > 0 ? origins : false, credentials: true });

  // Prefixo e versionamento da API (ERS §10).
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.enableShutdownHooks();

  // OpenAPI/Swagger (ERS §10) — fora de produção.
  if (config.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('SGE API')
      .setDescription('Sistema de Gestão Empresarial e Financeira — Sprint 1 (Fundação)')
      .setVersion('1.0')
      .addBearerAuth()
      .addGlobalParameters({
        name: 'x-company-id',
        in: 'header',
        required: false,
        description: 'Empresa ativa (obrigatório nas rotas por empresa)',
        schema: { type: 'string' },
      })
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);

  // Endereços úteis no terminal (clicáveis na maioria dos terminais).
  const logger = app.get(Logger);
  const base = `http://localhost:${port}`;
  logger.log(`API              -> ${base}/api/v1`);
  logger.log(`Health           -> ${base}/api/v1/health`);
  if (config.get('NODE_ENV') !== 'production') {
    logger.log(`Swagger/OpenAPI  -> ${base}/api/docs`);
  }
}

void bootstrap();
