import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntryType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { IsDateOnly } from '../../../common/utils/date-only';
import { IsMoney } from '../../../common/validators/decimal.decorator';

/**
 * Movimento digitado dentro de um cenário (RF-104).
 *
 * Não há campo de situação: projeção manual é sempre PREVISTA (bd/10). O valor
 * é sempre positivo — quem paga informa `type: PAGAR`, e é o tipo que dá a
 * direção. Sem essa regra, um sinal trocado vira entrada de caixa.
 */
export class CreateProjectionDto {
  @ApiProperty({ description: 'Data do movimento — precisa cair dentro da janela do cenário' })
  @IsDateOnly()
  referenceDate!: string;

  @ApiProperty({ enum: EntryType, description: 'RECEBER entra no caixa; PAGAR sai' })
  @IsEnum(EntryType)
  type!: EntryType;

  @ApiProperty({ description: 'Valor positivo — a direção vem do tipo' })
  @IsMoney()
  amount!: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;
}
