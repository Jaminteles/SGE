import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ApiDocsService } from './modules/integrations/api-docs.service';

async function bootstrap(): Promise<void> {
  // `rawBody`: a assinatura HMAC do webhook (RF-066) é calculada sobre o corpo
  // exatamente como o provedor o enviou — reserializar o JSON produziria outro
  // texto e outra assinatura.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
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

  // Padrao por ambiente quando a variavel nao e informada (ver env.validation).
  const swaggerUiEnabled =
    (config.get<string>('SWAGGER_UI_ENABLED') ??
      (config.get('NODE_ENV') === 'production' ? 'false' : 'true')) === 'true';

  // OpenAPI/Swagger (ERS §10, RF-131).
  //
  // O documento é montado sempre, inclusive em produção: quem integra precisa
  // da especificação, e ela sai por rota autenticada com permissão
  // (`GET /api/v1/integrations/api-docs`). O que fica restrito a fora de
  // produção é a **interface** do Swagger, que é pública por natureza — expor o
  // mapa completo dos endpoints a quem ainda não se autenticou é dar o primeiro
  // passo do reconhecimento de graça.
  {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('SGE API')
      .setDescription(
        'Sistema de Gestão Empresarial e Financeira — API REST multiempresa. ' +
          'O isolamento entre empresas é feito por Row Level Security no banco: ' +
          'toda rota por empresa exige o cabeçalho x-company-id.',
      )
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
    app.get(ApiDocsService).set(document);

    if (swaggerUiEnabled) {
      SwaggerModule.setup('api/docs', app, document);
    }
  }

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);

  // Endereços úteis no terminal (clicáveis na maioria dos terminais).
  const logger = app.get(Logger);
  const base = `http://localhost:${port}`;
  logger.log(`API              -> ${base}/api/v1`);
  logger.log(`Health           -> ${base}/api/v1/health`);
  if (swaggerUiEnabled) {
    logger.log(`Swagger/OpenAPI  -> ${base}/api/docs`);
  }
}

void bootstrap();
