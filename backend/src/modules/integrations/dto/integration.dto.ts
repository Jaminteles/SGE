import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IntegrationStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/** Ambientes aceitos por `ck_integracao_ambiente` (bd/20). */
export const INTEGRATION_ENVIRONMENTS = ['PRODUCAO', 'HOMOLOGACAO', 'SANDBOX'] as const;

/**
 * Cadastro de integração (RF-126).
 *
 * `parameters` é livre em forma mas não em conteúdo: chave com nome de
 * credencial é recusada aqui e no banco (bd/20 §3). Segredo se cadastra em
 * `POST /banking/credentials`, cifrado — o campo `credentialId` é a ligação.
 */
export class CreateIntegrationDto {
  @ApiProperty({ description: 'Provedor do catálogo global (`GET /banking/providers`)' })
  @IsUUID()
  providerId!: string;

  @ApiPropertyOptional({ description: 'Credencial cifrada que autentica a integração' })
  @IsOptional()
  @IsUUID()
  credentialId?: string;

  @ApiProperty({ description: 'Código curto e estável, único na empresa', example: 'BANCO-PIX' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message: 'code aceita apenas letras, números, ponto, hífen e sublinhado',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  code!: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ enum: INTEGRATION_ENVIRONMENTS, default: 'PRODUCAO' })
  @IsOptional()
  @IsIn(INTEGRATION_ENVIRONMENTS)
  environment?: (typeof INTEGRATION_ENVIRONMENTS)[number];

  @ApiPropertyOptional({
    description: 'Parâmetros não sensíveis do provedor. Nunca segredo (RF-127).',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;

  @ApiPropertyOptional({ minimum: 500, maximum: 120_000, default: 10_000 })
  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(120_000)
  timeoutMs?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxAttempts?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 10,
    description: 'Falhas seguidas que suspendem a integração (RF-128)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  failureThreshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/**
 * Alteração da integração (RF-126/RF-127).
 *
 * `code` fica de fora: ele é a referência estável usada em configuração e em
 * log, e renomeá-lo quebraria o rastro de tudo o que já foi registrado com o
 * nome antigo. `status` também — mudar situação é `POST .../activate`,
 * `/suspend` e `/resume`, que registram o motivo.
 */
export class UpdateIntegrationDto extends PartialType(
  OmitType(CreateIntegrationDto, ['code', 'providerId'] as const),
) {
  @ApiPropertyOptional({ description: 'Desativa sem remover o histórico' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Troca só os parâmetros (RF-127) — o corpo inteiro substitui o anterior. */
export class SetIntegrationParametersDto {
  @ApiProperty({ type: Object })
  @IsObject()
  parameters!: Record<string, unknown>;
}

/** Motivo obrigatório: suspensão sem motivo não explica nada depois. */
export class SuspendIntegrationDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class QueryIntegrationDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: IntegrationStatus })
  @IsOptional()
  @IsEnum(IntegrationStatus)
  status?: IntegrationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @ApiPropertyOptional({ enum: INTEGRATION_ENVIRONMENTS })
  @IsOptional()
  @IsIn(INTEGRATION_ENVIRONMENTS)
  environment?: (typeof INTEGRATION_ENVIRONMENTS)[number];
}

export class QueryIntegrationEventDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  integrationId?: string;

  @ApiPropertyOptional({ enum: ['INFO', 'AVISO', 'ERRO', 'CRITICO'] })
  @IsOptional()
  @IsIn(['INFO', 'AVISO', 'ERRO', 'CRITICO'])
  severity?: 'INFO' | 'AVISO' | 'ERRO' | 'CRITICO';

  @ApiPropertyOptional({ description: 'Natureza do evento (CHAMADA, ERRO, WEBHOOK, ...)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  type?: string;

  @ApiPropertyOptional({ description: 'Data inicial (ISO 8601)' })
  @IsOptional()
  @Type(() => Date)
  from?: Date;

  @ApiPropertyOptional({ description: 'Data final (ISO 8601)' })
  @IsOptional()
  @Type(() => Date)
  to?: Date;
}

/** Alvos que o reprocessamento sabe reexecutar (RF-130). */
export const REPROCESS_TARGETS = ['JOB', 'WEBHOOK'] as const;
export type ReprocessTarget = (typeof REPROCESS_TARGETS)[number];

export class ReprocessDto {
  @ApiProperty({ enum: REPROCESS_TARGETS, description: 'O que reexecutar' })
  @IsIn(REPROCESS_TARGETS)
  target!: ReprocessTarget;

  @ApiProperty({ description: 'Id do job ou do webhook que falhou' })
  @IsUUID()
  id!: string;

  @ApiPropertyOptional({ maxLength: 500, description: 'Por que está sendo reprocessado' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class QueryFailedWorkDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: REPROCESS_TARGETS, description: 'Filtra por natureza do trabalho' })
  @IsOptional()
  @IsIn(REPROCESS_TARGETS)
  target?: ReprocessTarget;
}
