import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountNature, LedgerAccountType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { ACCOUNT_CODE_PATTERN } from '../accounting.constants';

/** Cadastro de conta do plano de contas (RF-078/RF-079). */
export class CreateLedgerAccountDto {
  @ApiProperty({ example: '1.1.01.001', maxLength: 30 })
  @IsString()
  @Length(1, 30)
  @Matches(ACCOUNT_CODE_PATTERN, {
    message: 'code deve ser um código estruturado, como 1.1.01.001',
  })
  code!: string;

  @ApiPropertyOptional({ description: 'Código reduzido usado na digitação', maxLength: 15 })
  @IsOptional()
  @IsString()
  @Length(1, 15)
  shortCode?: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @Length(2, 255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @ApiProperty({ enum: LedgerAccountType })
  @IsEnum(LedgerAccountType)
  type!: LedgerAccountType;

  @ApiPropertyOptional({
    enum: AccountNature,
    description:
      'Opcional: decorre do tipo (RF-079). Informe apenas em conta de compensação, ' +
      'que é a única que aceita as duas.',
  })
  @IsOptional()
  @IsEnum(AccountNature)
  nature?: AccountNature;

  @ApiPropertyOptional({ description: 'Conta sintética à qual esta se subordina' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Analítica: recebe partida. Conta com filhas não pode aceitar lançamento — ' +
      'o saldo entraria duas vezes no balancete.',
  })
  @IsOptional()
  @IsBoolean()
  acceptsEntry?: boolean;

  @ApiPropertyOptional({ description: 'Conta referencial da Receita, para o SPED', maxLength: 20 })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  spedReferenceCode?: string;
}

/**
 * Alteração da conta.
 *
 * `code` e `type` ficam de fora de propósito: mudá-los reclassifica
 * retroativamente todo lançamento já feito na conta — o balancete de meses
 * fechados muda sem que nenhum lançamento tenha sido tocado. O caminho é criar
 * a conta nova e inativar a antiga, que preserva o histórico.
 */
export class UpdateLedgerAccountDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @Length(2, 255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @ApiPropertyOptional({ maxLength: 15 })
  @IsOptional()
  @IsString()
  @Length(1, 15)
  shortCode?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  spedReferenceCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  acceptsEntry?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Filtros do plano de contas (RF-078). */
export class QueryLedgerAccountDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LedgerAccountType })
  @IsOptional()
  @IsEnum(LedgerAccountType)
  type?: LedgerAccountType;

  @ApiPropertyOptional({ description: 'Só contas que recebem partida' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  acceptsEntry?: boolean;
}
