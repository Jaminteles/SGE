import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntryType, Periodicity } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { IsDateOnly } from '../../../common/utils/date-only';
import { IsMoney } from '../../../common/validators/decimal.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Contrato que gera títulos periodicamente (RF-053) — aluguel, mensalidade,
 * assinatura. Não gera nada sozinho: a geração é explícita
 * (`POST /recurrences/:id/generate`), para que exista sempre um responsável
 * identificável por cada título criado.
 */
export class CreateRecurrenceDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  @Transform(trim)
  description!: string;

  @ApiProperty({ enum: EntryType })
  @IsEnum(EntryType)
  type!: EntryType;

  @ApiProperty({ enum: Periodicity, description: 'UNICA não se repete e não gera segunda vez' })
  @IsEnum(Periodicity)
  periodicity!: Periodicity;

  @ApiProperty({ description: 'Primeira geração (YYYY-MM-DD)' })
  @IsDateOnly()
  startDate!: string;

  @ApiPropertyOptional({ description: 'Encerramento do contrato' })
  @IsOptional()
  @IsDateOnly()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Dia desejado do vencimento (1 a 31)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number;

  @ApiPropertyOptional({ description: 'Número máximo de ocorrências' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  maxOccurrences?: number;

  @ApiPropertyOptional({ description: 'Valor padrão do título gerado' })
  @IsOptional()
  @IsMoney()
  defaultAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  partnerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;
}
