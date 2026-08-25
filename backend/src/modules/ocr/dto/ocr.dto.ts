import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OcrStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsDateOnly } from '../../../common/utils/date-only';
import { IsMoney } from '../../../common/validators/decimal.decorator';
import { OCR_DOCUMENT_CATEGORIES, OcrDocumentCategory } from '../ocr.constants';

/** Envio do documento para leitura (RF-095). O arquivo vem no multipart. */
export class UploadOcrDocumentDto {
  @ApiPropertyOptional({ enum: OCR_DOCUMENT_CATEGORIES, default: 'COMPROVANTE' })
  @IsOptional()
  @IsIn(OCR_DOCUMENT_CATEGORIES)
  category?: OcrDocumentCategory;
}

/** Filtros da fila de processamentos (RF-095/RF-099). */
export class QueryOcrDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OcrStatus })
  @IsOptional()
  @IsEnum(OcrStatus)
  status?: OcrStatus;
}

/**
 * Correções da validação humana (RF-099).
 *
 * Todos os campos são opcionais: validar sem corrigir nada é o caso comum — a
 * pessoa conferiu e a leitura estava certa. O que vier aqui entra em
 * `correcoes`, **ao lado** do que a máquina leu, nunca por cima (bd/15 §6).
 */
export class ValidateOcrDto {
  @ApiPropertyOptional({ description: 'Valor correto, em decimal textual' })
  @IsOptional()
  @IsMoney()
  amount?: string;

  @ApiPropertyOptional({ description: 'Data do documento (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateOnly()
  issueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  merchantName?: string;

  @ApiPropertyOptional({ description: 'CPF (11) ou CNPJ (14), só dígitos' })
  @IsOptional()
  @Matches(/^(\d{11}|\d{14})$/, { message: 'merchantDocument deve ter 11 ou 14 dígitos' })
  merchantDocument?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 30)
  documentNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional({ description: 'Observação de quem validou' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

/** Rejeição da leitura (RF-099). O motivo é obrigatório: é a trilha. */
export class RejectOcrDto {
  @ApiProperty({ description: 'Por que a leitura foi rejeitada' })
  @IsString()
  @Length(3, 500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  reason!: string;
}
