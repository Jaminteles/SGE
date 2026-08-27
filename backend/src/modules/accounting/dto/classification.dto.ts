import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * Classificação contábil de uma origem financeira (RF-080).
 *
 * `accountId` nulo remove a classificação — é operação legítima (a conta foi
 * criada errada e ainda não foi usada), mas deixa a origem sem contrapartida:
 * a contabilização automática passa a recusar em vez de escolher uma conta
 * plausível, que é o comportamento correto.
 */
export class AssignLedgerAccountDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Conta analítica que recebe a partida. Nulo remove a classificação.',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string | null;
}

/** Filtros da lista de origens classificáveis (RF-080). */
export class QueryClassificationDto {
  @ApiPropertyOptional({ description: 'Só o que ainda não tem conta contábil' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  unclassifiedOnly?: boolean;
}

/** Uma origem financeira e a conta contábil dela. */
export class ClassificationResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  ledgerAccountId!: string | null;

  @ApiProperty({ nullable: true })
  ledgerAccountCode!: string | null;

  @ApiProperty({ nullable: true })
  ledgerAccountName!: string | null;
}
