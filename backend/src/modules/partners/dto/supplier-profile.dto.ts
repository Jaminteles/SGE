import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

/** Dados do papel fornecedor (RF-023, RF-026) — `gestao.fornecedor`. */
export class SupplierProfileDto {
  @ApiPropertyOptional({ description: 'Condição de pagamento padrão (RF-026)' })
  @IsOptional()
  @IsUUID()
  paymentTermId?: string;

  @ApiPropertyOptional({ description: 'Forma de pagamento padrão (RF-026)' })
  @IsOptional()
  @IsUUID()
  paymentMethodId?: string;

  @ApiPropertyOptional({ description: 'Prazo médio de entrega, em dias' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? parseInt(value, 10) : value))
  @IsInt()
  @Min(0)
  @Max(999)
  deliveryDays?: number;

  @ApiPropertyOptional({ description: 'Categoria financeira padrão das compras' })
  @IsOptional()
  @IsUUID()
  defaultCategoryId?: string;

  @ApiPropertyOptional({ description: 'Fornecedor homologado' })
  @IsOptional()
  @IsBoolean()
  isApproved?: boolean;

  @ApiPropertyOptional({ description: 'Bloqueia novas compras do fornecedor' })
  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;

  @ApiPropertyOptional({ description: 'Motivo do bloqueio — exigido ao bloquear' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  blockReason?: string;
}
