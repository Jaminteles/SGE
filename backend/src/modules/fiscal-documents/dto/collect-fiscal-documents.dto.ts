import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { FiscalDocumentOrigin } from '@prisma/client';

/** Tamanho máximo do XML aceito no corpo JSON — o mesmo teto do leitor. */
export const MAX_XML_LENGTH = 2 * 1024 * 1024;

/** Quantos documentos um lote pode trazer. */
export const MAX_COLLECT_BATCH = 50;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Um documento entregue pela integração. */
export class CollectedFiscalDocumentDto {
  @ApiProperty({ description: 'XML do documento, como texto' })
  @IsString()
  @MaxLength(MAX_XML_LENGTH)
  xml!: string;

  @ApiPropertyOptional({
    description:
      'Identificador do documento na origem. É a chave de idempotência: reenviar ' +
      'a mesma referência devolve o documento já importado (RF-050).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  originReference?: string;

  @ApiPropertyOptional({ description: 'Quando a origem disponibilizou o documento' })
  @IsOptional()
  @IsISO8601()
  collectedAt?: string;
}

/**
 * Lote de documentos vindo de integração externa (RF-050).
 *
 * O lote é processado documento a documento e a resposta diz o que aconteceu com
 * cada um — importado, já conhecido, duplicado ou recusado. Um XML ruim no meio
 * do lote não derruba os outros: um coletor que reenvia tudo porque um item
 * falhou é um coletor que duplica trabalho a cada tentativa.
 */
export class CollectFiscalDocumentsDto {
  @ApiPropertyOptional({
    enum: FiscalDocumentOrigin,
    description: 'Como o lote chegou. Padrão: COLETA_AUTOMATICA',
  })
  @IsOptional()
  @IsEnum(FiscalDocumentOrigin)
  origin?: FiscalDocumentOrigin;

  @ApiPropertyOptional({ description: 'Filial de destino dos documentos do lote' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiProperty({ type: [CollectedFiscalDocumentDto], maxItems: MAX_COLLECT_BATCH })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_COLLECT_BATCH)
  @ValidateNested({ each: true })
  @Type(() => CollectedFiscalDocumentDto)
  documents!: CollectedFiscalDocumentDto[];
}
