import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReconciliationOrigin, ReconciliationStatus, TransactionDirection } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsDateOnly } from '../../../common/utils/date-only';
import { IsMoney } from '../../../common/validators/decimal.decorator';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/**
 * Conciliação manual (RF-074).
 *
 * Ao menos um alvo é obrigatório — parcela, baixa ou ordem de pagamento. O
 * banco também exige (`ck_conciliacao_alvo`): um vínculo sem alvo tiraria o
 * movimento de NAO_CONCILIADO sem ter par, que é a forma silenciosa de o
 * extrato "fechar" sem nada ter sido conferido.
 */
export class CreateReconciliationDto {
  @ApiProperty({ description: 'Movimento bancário importado do extrato' })
  @IsUUID()
  bankTransactionId!: string;

  @ApiPropertyOptional({ description: 'Parcela do título correspondente' })
  @IsOptional()
  @IsUUID()
  installmentId?: string;

  @ApiPropertyOptional({ description: 'Baixa já lançada que este movimento representa' })
  @IsOptional()
  @IsUUID()
  settlementId?: string;

  @ApiPropertyOptional({ description: 'Ordem de pagamento que originou o movimento' })
  @IsOptional()
  @IsUUID()
  paymentTransactionId?: string;

  @ApiProperty({ description: 'Parte do movimento atribuída a este alvo, em reais' })
  @IsMoney()
  amount!: string;

  @ApiPropertyOptional({
    description:
      'Obrigatória quando o valor conciliado difere do lançamento: divergência sem ' +
      'explicação é divergência que ninguém investiga (RF-076).',
  })
  @IsOptional()
  @IsString()
  @Length(3, 500)
  justification?: string;
}

/** Desfazimento (RF-074/RF-077): evento com autor e motivo, não uma exclusão. */
export class UndoReconciliationDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @Length(3, 500)
  reason!: string;
}

/** Movimento sem par: tarifa, rendimento, transferência entre contas próprias. */
export class IgnoreBankTransactionDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @Length(3, 500)
  reason!: string;
}

/** Filtros do histórico de conciliações (RF-077). */
export class QueryReconciliationDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  bankTransactionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  installmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiPropertyOptional({ enum: ReconciliationOrigin })
  @IsOptional()
  @IsEnum(ReconciliationOrigin)
  origin?: ReconciliationOrigin;

  @ApiPropertyOptional({ description: 'Conciliações criadas a partir desta data (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @ApiPropertyOptional({ description: 'Conciliações criadas até esta data (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  to?: string;

  @ApiPropertyOptional({ description: 'Somente confirmadas, ou somente sugestões' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  confirmed?: boolean;

  @ApiPropertyOptional({ description: 'Somente as que apresentam diferença (RF-076)' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasDivergence?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Inclui as desfeitas — o histórico completo do movimento (RF-077)',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeUndone?: boolean;
}

/** Parâmetros da busca de correspondências (RF-073). */
export class QuerySuggestionDto {
  @ApiPropertyOptional({
    minimum: 0,
    maximum: 60,
    default: 5,
    description: 'Janela entre a data do movimento e o vencimento da parcela',
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? value : parseInt(value as string, 10)))
  @IsInt()
  @Min(0)
  @Max(60)
  dayTolerance?: number;

  @ApiPropertyOptional({ default: '0.00', description: 'Diferença de valor aceita, em reais' })
  @IsOptional()
  @IsMoney()
  valueTolerance?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 5 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? value : parseInt(value as string, 10)))
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

/**
 * Execução da conciliação automática (RF-075).
 *
 * Sempre por conta e período: rodar sobre "tudo" é o pedido que trava a fila e
 * cujo resultado ninguém confere.
 */
export class RunAutoReconciliationDto {
  @ApiProperty()
  @IsUUID()
  bankAccountId!: string;

  @ApiProperty({ description: 'Movimentos a partir desta data (inclusivo)' })
  @IsDateOnly()
  from!: string;

  @ApiProperty({ description: 'Movimentos até esta data (inclusivo)' })
  @IsDateOnly()
  to!: string;
}

/** Filtros do painel de divergências (RF-076). */
export class QueryDivergenceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiPropertyOptional({ description: 'Período a partir desta data (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @ApiPropertyOptional({ description: 'Período até esta data (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  to?: string;
}

/** Filtros dos movimentos pendentes de conciliação (RF-072). */
export class QueryPendingDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiPropertyOptional({ enum: TransactionDirection })
  @IsOptional()
  @IsEnum(TransactionDirection)
  direction?: TransactionDirection;

  @ApiPropertyOptional({ enum: ReconciliationStatus, isArray: false })
  @IsOptional()
  @IsEnum(ReconciliationStatus)
  status?: ReconciliationStatus;

  @ApiPropertyOptional({ description: 'Movimentos a partir desta data (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @ApiPropertyOptional({ description: 'Movimentos até esta data (inclusivo)' })
  @IsOptional()
  @IsDateOnly()
  to?: string;
}
