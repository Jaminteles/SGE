import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsDateOnly } from '../../../common/utils/date-only';
import { IsMoney } from '../../../common/validators/decimal.decorator';

/**
 * Premissas do cenário (RF-104).
 *
 * Uma classe, e não `Record<string, unknown>`: as duas hipóteses de hoje têm
 * significado e faixa, e o banco recusa qualquer chave fora desta lista
 * (bd/10). Validar aqui transforma o que seria um 500 de trigger numa
 * mensagem de campo.
 *
 * Ambas ajustam apenas o que **ainda não aconteceu** — previsto e vencido. O
 * realizado é fato: não se estima o que já saiu da conta.
 */
export class ScenarioAssumptionsDto {
  @ApiPropertyOptional({
    minimum: -100,
    maximum: 100,
    description: 'Variação (%) aplicada às entradas ainda não realizadas',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-100)
  @Max(100)
  entradas_percentual?: number;

  @ApiPropertyOptional({
    minimum: -100,
    maximum: 100,
    description: 'Variação (%) aplicada às saídas ainda não realizadas',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-100)
  @Max(100)
  saidas_percentual?: number;
}

/** Cenário de planejamento: janela, caixa de partida e hipóteses (RF-104). */
export class CreateScenarioDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Primeiro dia da janela (YYYY-MM-DD)' })
  @IsDateOnly()
  startDate!: string;

  @ApiProperty({ description: 'Último dia da janela (YYYY-MM-DD)' })
  @IsDateOnly()
  endDate!: string;

  @ApiPropertyOptional({
    description: 'Caixa no primeiro dia da janela (padrão: saldo atual das contas ativas)',
  })
  @IsOptional()
  @IsMoney()
  openingBalance?: string;

  @ApiPropertyOptional({ type: ScenarioAssumptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ScenarioAssumptionsDto)
  assumptions?: ScenarioAssumptionsDto;

  @ApiPropertyOptional({
    description: 'Marca como cenário base — só um por empresa; o anterior deixa de ser',
  })
  @IsOptional()
  @IsBoolean()
  isBaseline?: boolean;
}
