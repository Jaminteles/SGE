import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { FiscalEventStatus, FiscalEventType } from '../../../common/enums';
import { MAX_EVENT_SEQUENCE, MIN_JUSTIFICATION_LENGTH } from '../fiscal.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Registro do evento fiscal (RF-092).
 *
 * O evento nasce REGISTRADO: registrar é declarar o que se pretende transmitir,
 * e é isso que fica como prova. Protocolo e status vêm depois, do provedor — a
 * API não os aceita aqui, senão qualquer chamada poderia declarar uma
 * autorização que a SEFAZ nunca deu.
 */
export class CreateFiscalEventDto {
  @ApiProperty({ enum: FiscalEventType })
  @IsEnum(FiscalEventType)
  type!: FiscalEventType;

  @ApiPropertyOptional({
    description: 'Documento do evento. Obrigatório em tudo que não é inutilização.',
  })
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_EVENT_SEQUENCE,
    description: 'Sequência do evento no documento. Padrão: a próxima livre.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? value : parseInt(value as string, 10)))
  @IsInt()
  @Min(1)
  @Max(MAX_EVENT_SEQUENCE)
  sequence?: number;

  @ApiPropertyOptional({
    description: `Obrigatória em cancelamento e carta de correção, com pelo menos ${MIN_JUSTIFICATION_LENGTH} caracteres.`,
  })
  @IsOptional()
  @IsString()
  @MinLength(MIN_JUSTIFICATION_LENGTH)
  @MaxLength(1000)
  @Transform(trim)
  justification?: string;

  @ApiPropertyOptional({ description: 'XML do evento, quando gerado fora do sistema.' })
  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  xmlContent?: string;
}

/**
 * Retorno do fisco lançado a mão (RF-092/RF-094).
 *
 * É o caminho de quem transmite por fora — pelo emissor da contabilidade, por
 * exemplo. O protocolo é obrigatório porque resposta do fisco sem protocolo não
 * é resposta, e o banco recusa (bd/18 §6).
 */
export class SettleFiscalEventDto {
  @ApiProperty({
    enum: [FiscalEventStatus.AUTORIZADO, FiscalEventStatus.REJEITADO],
  })
  @IsEnum(FiscalEventStatus)
  status!: FiscalEventStatus;

  @ApiProperty({ maxLength: 40 })
  @IsString()
  @Length(1, 40)
  @Transform(trim)
  protocol!: string;

  @ApiPropertyOptional({ description: 'Mensagem devolvida pelo fisco' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trim)
  message?: string;
}

/** Filtros dos eventos fiscais (RF-092). */
export class QueryFiscalEventDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({ enum: FiscalEventType })
  @IsOptional()
  @IsEnum(FiscalEventType)
  type?: FiscalEventType;

  @ApiPropertyOptional({ enum: FiscalEventStatus })
  @IsOptional()
  @IsEnum(FiscalEventStatus)
  status?: FiscalEventStatus;
}
