import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsMoney } from '../../../common/validators/decimal.decorator';
import { IsDateOnly } from '../../../common/utils/date-only';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Despesa individual da solicitação (RF-018) — `gestao.reembolso_item`. */
export class ReimbursementItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @Transform(trim)
  description!: string;

  @ApiProperty({ description: 'Data da despesa (YYYY-MM-DD)' })
  @IsDateOnly()
  expenseDate!: string;

  @ApiProperty({ description: 'Valor da despesa (decimal, maior que zero)' })
  @IsMoney()
  amount!: string;

  @ApiPropertyOptional({ description: 'Categoria financeira da despesa' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Centro de custo de apropriação (RF-016)' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/**
 * Solicitação de reembolso (RF-018) — `gestao.reembolso`.
 *
 * O número é gerado pelo banco (sequencial por empresa e ano) e o valor total
 * sai da soma dos itens: nenhum dos dois é aceito do cliente.
 */
export class CreateReimbursementDto {
  @ApiProperty({ description: 'Funcionário solicitante' })
  @IsUUID()
  employeeId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  @Transform(trim)
  description!: string;

  @ApiPropertyOptional({ description: 'Filial de origem da despesa' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Centro de custo padrão da solicitação (RF-016)' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiProperty({ type: [ReimbursementItemDto], description: 'Despesas da solicitação' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReimbursementItemDto)
  items!: ReimbursementItemDto[];
}
