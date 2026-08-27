import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountingPeriodStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/**
 * Abertura dos períodos de um exercício (RF-086).
 *
 * Abre o ano inteiro de uma vez porque período é calendário, não decisão: os
 * doze meses de 2026 existem independentemente de alguém os cadastrar, e a
 * ausência de um deles só aparece no dia em que um lançamento é recusado por
 * "não há período para a competência".
 */
export class OpenAccountingYearDto {
  @ApiProperty({ minimum: 1900, maximum: 2999, example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2999)
  year!: number;
}

/** Fechamento do período (RF-086, RN-008). */
export class CloseAccountingPeriodDto {
  @ApiPropertyOptional({
    description:
      'Fecha em duas etapas: `EM_FECHAMENTO` ainda aceita ajuste, `FECHADO` não aceita nada.',
    enum: [AccountingPeriodStatus.EM_FECHAMENTO, AccountingPeriodStatus.FECHADO],
    default: AccountingPeriodStatus.FECHADO,
  })
  @IsOptional()
  @IsEnum(AccountingPeriodStatus)
  status?: AccountingPeriodStatus;
}

/**
 * Reabertura do período (RF-086).
 *
 * O motivo é obrigatório e não tem valor padrão: o mês já foi entregue ao
 * contador, e "por que este número mudou depois de fechado" é a única pergunta
 * que importa quando ele muda.
 */
export class ReopenAccountingPeriodDto {
  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @Length(5, 500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  reason!: string;
}

/** Filtros da lista de períodos (RF-086). */
export class QueryAccountingPeriodDto {
  @ApiPropertyOptional({ minimum: 1900, maximum: 2999 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2999)
  year?: number;

  @ApiPropertyOptional({ enum: AccountingPeriodStatus })
  @IsOptional()
  @IsEnum(AccountingPeriodStatus)
  status?: AccountingPeriodStatus;
}
