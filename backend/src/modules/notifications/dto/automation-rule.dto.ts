import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { EntryType, NotificationChannel } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
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
import { AUTOMATION_TRIGGERS, SUPPORTED_CHANNELS } from '../notifications.constants';

/**
 * Condições de uma regra (RF-125).
 *
 * A coluna é `jsonb` para o conjunto crescer sem migration, mas a forma é
 * fechada aqui: o motor só entende estas chaves, e `forbidNonWhitelisted` na
 * ValidationPipe recusa as demais. Uma condição que o motor ignora é uma regra
 * que avisa mais — ou menos — do que quem a escreveu autorizou, e ninguém
 * descobre isso olhando a tela.
 *
 * Não existe condição por expressão regular, pela mesma razão das regras de
 * conciliação: expressão vinda do cliente é ReDoS no processo que roda a
 * varredura de todas as empresas.
 */
export class AutomationConditionsDto {
  @ApiPropertyOptional({
    minimum: 0,
    maximum: 90,
    description: 'Horizonte do alerta de vencimento, em dias (RF-121)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  daysAhead?: number;

  @ApiPropertyOptional({ description: 'Ignora o que estiver abaixo deste valor' })
  @IsOptional()
  @IsMoney()
  minAmount?: string;

  @ApiPropertyOptional({ enum: EntryType, description: 'Restringe a PAGAR ou a RECEBER' })
  @IsOptional()
  @IsEnum(EntryType)
  entryType?: EntryType;

  @ApiPropertyOptional({
    default: true,
    description: 'Inclui o que já venceu, além do que vai vencer',
  })
  @IsOptional()
  @IsBoolean()
  includeOverdue?: boolean;
}

/**
 * O que a regra faz com o fato observado (RF-125).
 *
 * **Só notificar.** Não há ação que prorrogue parcela, cancele ordem ou concilie
 * movimento, e essa ausência é a decisão central do módulo: uma regra que
 * agisse sobre o financeiro transformaria um erro de configuração em dinheiro
 * movimentado, sem ninguém no caminho. A decisão continua humana; a automação
 * garante que a pessoa certa seja avisada.
 */
export class AutomationActionDto {
  @ApiProperty({ enum: ['NOTIFICAR'], default: 'NOTIFICAR' })
  @IsIn(['NOTIFICAR'])
  type!: 'NOTIFICAR';

  @ApiProperty({ enum: SUPPORTED_CHANNELS })
  @IsIn(SUPPORTED_CHANNELS)
  channel!: NotificationChannel;

  @ApiPropertyOptional({
    description:
      'Notifica quem tem esta permissão na empresa, no formato `recurso:AÇÃO`. ' +
      'É o endereçamento que acompanha o RBAC: quem pode aprovar é quem precisa saber.',
  })
  @IsOptional()
  @IsString()
  @Length(3, 80)
  permission?: string;

  @ApiPropertyOptional({ description: 'Usuários nomeados, além (ou em vez) da permissão' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  userIds?: string[];

  @ApiPropertyOptional({ minimum: 1, maximum: 5, default: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  priority?: number;
}

export class CreateAutomationRuleDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @Length(2, 120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  description?: string;

  @ApiProperty({ enum: AUTOMATION_TRIGGERS })
  @IsIn(AUTOMATION_TRIGGERS)
  triggerEvent!: (typeof AUTOMATION_TRIGGERS)[number];

  @ApiPropertyOptional({ type: AutomationConditionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AutomationConditionsDto)
  conditions?: AutomationConditionsDto;

  @ApiProperty({ type: AutomationActionDto, isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AutomationActionDto)
  actions!: AutomationActionDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateAutomationRuleDto extends PartialType(CreateAutomationRuleDto) {}

/** Filtros da lista de regras (RF-125). */
export class QueryAutomationRuleDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AUTOMATION_TRIGGERS })
  @IsOptional()
  @IsIn(AUTOMATION_TRIGGERS)
  triggerEvent?: string;
}
