import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsMoney } from '../../../common/validators/decimal.decorator';

/**
 * Configuração do alerta de insuficiência de caixa (RF-105).
 *
 * `daysAhead` fica entre 1 e 180 (bd/10): avisar no dia em que o dinheiro falta
 * é tarde demais, e projetar dois anos à frente dispara sempre, sobre títulos
 * que ainda nem existem.
 */
export class CreateCashAlertDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    description: 'Conta bancária de referência. Sem ela, o alerta olha o caixa da empresa.',
  })
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiProperty({ description: 'Saldo mínimo tolerado' })
  @IsMoney()
  minimumBalance!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 180, default: 7 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? parseInt(value, 10) : value))
  @IsInt()
  @Min(1)
  @Max(180)
  daysAhead?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
