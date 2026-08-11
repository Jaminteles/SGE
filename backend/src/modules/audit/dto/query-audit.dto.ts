import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { AuditEvent } from '@prisma/client';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Filtros da consulta à trilha de auditoria (RF-117).
 *
 * Não estende PaginationQueryDto: `q` (busca textual) e `isActive` não fazem
 * sentido numa trilha imutável, e `forbidNonWhitelisted` rejeitaria o que não
 * for declarado aqui.
 */
export class QueryAuditDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;

  @ApiPropertyOptional({ enum: AuditEvent, description: 'Tipo de evento (RF-114)' })
  @IsOptional()
  @IsEnum(AuditEvent)
  event?: AuditEvent;

  @ApiPropertyOptional({ description: 'Tabela auditada, ex.: `titulo`, `usuario_empresa`' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  entity?: string;

  @ApiPropertyOptional({ description: 'Registro auditado' })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ description: 'Autor da ação' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Início do período (ISO 8601, inclusivo)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'Fim do período (ISO 8601, exclusivo)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }

  get take(): number {
    return this.pageSize;
  }
}
