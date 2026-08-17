import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { FiscalDocumentModel, FiscalDocumentOrigin, FiscalDocumentStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** Filtros da consulta de documentos fiscais (RF-045/RF-049). */
export class QueryFiscalDocumentDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FiscalDocumentStatus })
  @IsOptional()
  @IsEnum(FiscalDocumentStatus)
  status?: FiscalDocumentStatus;

  @ApiPropertyOptional({ enum: FiscalDocumentModel })
  @IsOptional()
  @IsEnum(FiscalDocumentModel)
  model?: FiscalDocumentModel;

  @ApiPropertyOptional({ enum: FiscalDocumentOrigin })
  @IsOptional()
  @IsEnum(FiscalDocumentOrigin)
  origin?: FiscalDocumentOrigin;

  @ApiPropertyOptional({ description: 'Fornecedor emitente já vinculado' })
  @IsOptional()
  @IsUUID()
  issuerPartnerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @ApiPropertyOptional({ description: 'Emitido a partir de (inclusivo)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Emitido até (exclusivo)' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    description:
      'Somente o que ainda exige ação: erro de processamento, sem fornecedor ' +
      'vinculado, sem entrada de estoque ou sem título (RF-049)',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  pendingOnly?: boolean;
}
