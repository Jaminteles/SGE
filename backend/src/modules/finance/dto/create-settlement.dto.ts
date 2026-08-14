import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethodType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsDateOnly } from '../../../common/utils/date-only';
import { IsMoney } from '../../../common/validators/decimal.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/**
 * Pagamento ou recebimento, total ou parcial (RF-057).
 *
 * `principalAmount` é a dívida quitada — é ele, e só ele, que abate o saldo da
 * parcela. Juros e multa entram no caixa sem reduzir o principal; o desconto
 * reduz o caixa sem deixar dívida. Quem quita 400 concedendo 20 informa
 * principal 400 e desconto 20: a parcela fecha e saem 380.
 */
export class CreateSettlementDto {
  @ApiProperty({ description: 'Principal quitado (decimal em string)' })
  @IsMoney()
  principalAmount!: string;

  @ApiPropertyOptional({ description: 'Juros de mora cobrados (padrão: 0)' })
  @IsOptional()
  @IsMoney()
  interestAmount?: string;

  @ApiPropertyOptional({ description: 'Multa cobrada (padrão: 0)' })
  @IsOptional()
  @IsMoney()
  penaltyAmount?: string;

  @ApiPropertyOptional({ description: 'Desconto concedido na liquidação (padrão: 0)' })
  @IsOptional()
  @IsMoney()
  discountAmount?: string;

  @ApiPropertyOptional({
    description:
      'Calcula juros e multa do atraso pelas taxas da parcela. Ignorado se os valores forem informados.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  applyLateCharges?: boolean;

  @ApiPropertyOptional({ description: 'Data da baixa (padrão: hoje)' })
  @IsOptional()
  @IsDateOnly()
  settlementDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  paymentMethodId?: string;

  @ApiPropertyOptional({ enum: PaymentMethodType, description: 'Meio usado, quando avulso' })
  @IsOptional()
  @IsEnum(PaymentMethodType)
  method?: PaymentMethodType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  note?: string;
}

/** Estorno da baixa (RF-057) — lançamento contrário, nunca remoção. */
export class ReverseSettlementDto {
  @ApiProperty({ description: 'Motivo do estorno' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}
