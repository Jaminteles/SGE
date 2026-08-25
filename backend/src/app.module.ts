import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ValidationPipe } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { IncomingMessage } from 'node:http';

import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TenantContextMiddleware } from './common/middleware/tenant-context.middleware';
import { TransactionInterceptor } from './common/interceptors/transaction.interceptor';
import { AuditModule } from './common/audit/audit.module';
import { StorageModule } from './common/storage/storage.module';
import { ReferencesModule } from './common/references/references.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { QueueModule } from './common/queue/queue.module';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { BranchesModule } from './modules/branches/branches.module';
import { RolesModule } from './modules/roles/roles.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { ConfigurationsModule } from './modules/configurations/configurations.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { AuditQueryModule } from './modules/audit/audit.module';
import { HrModule } from './modules/hr/hr.module';
import { PartnersModule } from './modules/partners/partners.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { StockModule } from './modules/stock/stock.module';
import { FinanceModule } from './modules/finance/finance.module';
import { CashFlowModule } from './modules/cash-flow/cash-flow.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { FiscalDocumentsModule } from './modules/fiscal-documents/fiscal-documents.module';
import { BankingModule } from './modules/banking/banking.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { OcrModule } from './modules/ocr/ocr.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),

    // Logs estruturados com correlation id (RNF-010).
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get('NODE_ENV') === 'production' ? 'info' : 'debug',
          genReqId: (req: IncomingMessage) =>
            (req.headers['x-correlation-id'] as string) ?? randomUUID(),
          customProps: (req) => ({ correlationId: (req as IncomingMessage & { id?: string }).id }),
          // Nunca logar credenciais/segredos.
          redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password'],
          transport:
            config.get('NODE_ENV') !== 'production'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),

    // Rate limiting (ERS §10 / §11).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.getOrThrow<number>('THROTTLE_TTL_SECONDS') * 1000,
            limit: config.getOrThrow<number>('THROTTLE_LIMIT'),
          },
        ],
      }),
    }),

    PrismaModule,
    // Global: os módulos de negócio emitem eventos sem importá-lo (M16).
    AuditModule,
    // Global: armazenamento de arquivos (comprovantes — RF-019; anexos — RF-048).
    StorageModule,
    // Global: valida referências entre cadastros dentro da empresa (RF-005).
    ReferencesModule,
    // Global: cifra os segredos de integração (RNF-003).
    CryptoModule,
    // Global: execução idempotente do que move dinheiro (RF-067).
    IdempotencyModule,
    // Global: fila e runner de jobs (RF-069/RF-070).
    QueueModule,

    AuthModule,
    UsersModule,
    CompaniesModule,
    BranchesModule,
    RolesModule,
    MembershipsModule,
    ConfigurationsModule,
    ApprovalsModule,
    AuditQueryModule,
    HrModule,
    PartnersModule,
    CatalogModule,
    StockModule,
    FinanceModule,
    CashFlowModule,
    PurchasingModule,
    FiscalDocumentsModule,
    BankingModule,
    ReconciliationModule,
    OcrModule,
    HealthModule,
  ],
  providers: [
    // Ordem importa: throttling -> autenticação -> autorização.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Confirma/reverte a transação que carrega o contexto de RLS da requisição.
    { provide: APP_INTERCEPTOR, useClass: TransactionInterceptor },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule implements NestModule {
  /**
   * Toda rota da API roda dentro da transação que define `app.empresa_id` e
   * `app.usuario_id` — sem isso a RLS do banco devolve zero linhas (RN-001).
   * O health check fica de fora: só precisa de um SELECT 1.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantContextMiddleware)
      // O webhook fica de fora porque não tem empresa vinda de header: ele abre
      // o próprio contexto de sistema, com a empresa que vem na URL e a origem
      // WEBHOOK (bd/13 §10) — e precisa persistir o evento mesmo respondendo 401.
      .exclude('api/v1/health', 'api/v1/banking/webhooks/(.*)', 'api/docs', 'api/docs/(.*)')
      .forRoutes('*');
  }
}
