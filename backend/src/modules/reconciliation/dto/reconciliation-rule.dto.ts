import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { TransactionDirection } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsMoney } from '../../../common/validators/decimal.decorator';

/**
 * Critérios de uma regra (RF-075).
 *
 * A coluna é `jsonb` para o conjunto crescer sem migration, mas a forma é
 * fechada aqui: o motor só entende estas chaves, e `forbidNonWhitelisted` na
 * ValidationPipe recusa as demais. Uma regra com um critério que o motor ignora
 * é uma regra que concilia mais do que quem a escreveu autorizou — e ninguém
 * descobre isso olhando a tela.
 *
 * Não existe critério por expressão regular de propósito: expressão vinda do
 * cliente é ReDoS no processo que roda a conciliação de todas as empresas.
 */
export class ReconciliationRuleConditionsDto {
  @ApiPropertyOptional({ enum: TransactionDirection })
  @IsOptional()
  @IsEnum(TransactionDirection)
  direction?: TransactionDirection;

  @ApiPropertyOptional({
    description: 'Trecho do histórico do extrato, sem diferenciar acentuação',
  })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  descriptionContains?: string;

  @ApiPropertyOptional({ description: 'Documento do movimento, igual' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  documentEquals?: string;

  @ApiPropertyOptional({ description: 'CPF/CNPJ da contraparte, só dígitos' })
  @IsOptional()
  @IsString()
  @Length(11, 14)
  counterpartDocument?: string;

  @ApiPropertyOptional({ description: 'Valor mínimo do movimento' })
  @IsOptional()
  @IsMoney()
  minAmount?: string;

  @ApiPropertyOptional({ description: 'Valor máximo do movimento' })
  @IsOptional()
  @IsMoney()
  maxAmount?: string;

  @ApiPropertyOptional({ description: 'Restringe a regra a uma conta bancária' })
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;
}

/** O que a regra faz com o movimento que casou (RF-075). */
export class ReconciliationRuleActionsDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Confirma o vínculo sem revisão humana. Exige `minScore`: conciliar sozinho com ' +
      'confiança baixa é o erro que a conciliação existe para evitar.',
  })
  @IsOptional()
  @IsBoolean()
  autoReconcile?: boolean;

  @ApiPropertyOptional({ description: 'Confiança mínima da correspondência, de 0 a 100' })
  @IsOptional()
  @IsMoney()
  minScore?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Marca o movimento como ignorado, para o que não tem título: tarifa, ' +
      'rendimento, transferência entre contas próprias.',
  })
  @IsOptional()
  @IsBoolean()
  markIgnored?: boolean;
}

export class CreateReconciliationRuleDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 1000,
    default: 100,
    description: 'Menor decide primeiro; a primeira regra que casa encerra a avaliação',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;

  @ApiProperty({ type: ReconciliationRuleConditionsDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ReconciliationRuleConditionsDto)
  conditions!: ReconciliationRuleConditionsDto;

  @ApiProperty({ type: ReconciliationRuleActionsDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ReconciliationRuleActionsDto)
  actions!: ReconciliationRuleActionsDto;

  @ApiPropertyOptional({ default: '0.00', description: 'Diferença de valor aceita, em reais' })
  @IsOptional()
  @IsMoney()
  valueTolerance?: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 60,
    default: 3,
    description: 'Janela entre a data do movimento e o vencimento da parcela',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  dayTolerance?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateReconciliationRuleDto extends PartialType(CreateReconciliationRuleDto) {}

export class QueryReconciliationRuleDto extends PaginationQueryDto {}
