import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Cancelamento da ordem (RF-065). O motivo é obrigatório: o banco exige. */
export class CancelPaymentDto {
  @ApiProperty({ description: 'Por que a ordem foi cancelada — vai para a trilha' })
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  @Transform(trim)
  reason!: string;
}

/**
 * Confirmação manual (RF-064).
 *
 * Existe para o provedor `MANUAL` e para o caso em que o webhook não chega: um
 * operador declara que o banco pagou. Tem permissão própria
 * (`payments:APPROVE`) justamente porque é a afirmação que gera a baixa do
 * título — dinheiro saindo do sistema sem ninguém ter falado com o banco.
 */
export class ConfirmPaymentDto {
  @ApiPropertyOptional({ description: 'Identificador da operação no banco (RF-068)' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  @Transform(trim)
  externalId?: string;

  @ApiPropertyOptional({ description: 'Quando o banco confirmou (ISO 8601). Padrão: agora.' })
  @IsOptional()
  @IsISO8601()
  confirmedAt?: string;

  @ApiPropertyOptional({ description: 'Observação registrada na baixa gerada' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(trim)
  note?: string;
}
