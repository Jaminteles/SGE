import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { IsMoney } from '../../../common/validators/decimal.decorator';

/** Dados do papel cliente (RF-022, RF-026) — `gestao.cliente`. */
export class CustomerProfileDto {
  @ApiPropertyOptional({ description: 'Limite de crédito (decimal)', example: '10000.00' })
  @IsOptional()
  @IsMoney()
  creditLimit?: string;

  @ApiPropertyOptional({ description: 'Condição de pagamento padrão (RF-026)' })
  @IsOptional()
  @IsUUID()
  paymentTermId?: string;

  @ApiPropertyOptional({ description: 'Forma de pagamento padrão (RF-026)' })
  @IsOptional()
  @IsUUID()
  paymentMethodId?: string;

  @ApiPropertyOptional({ description: 'Funcionário responsável pela conta' })
  @IsOptional()
  @IsUUID()
  salesRepId?: string;

  @ApiPropertyOptional({ description: 'Dia de vencimento preferencial (1 a 31)' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? parseInt(value, 10) : value))
  @IsInt()
  @Min(1)
  @Max(31)
  preferredDueDay?: number;

  @ApiPropertyOptional({ description: 'Bloqueia novas operações com o cliente' })
  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;

  @ApiPropertyOptional({ description: 'Motivo do bloqueio — exigido ao bloquear' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  blockReason?: string;
}
