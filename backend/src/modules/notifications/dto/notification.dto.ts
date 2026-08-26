import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { NOTIFICATION_TYPES, SUPPORTED_CHANNELS } from '../notifications.constants';

const TYPES = Object.values(NOTIFICATION_TYPES);

/** Filtros da caixa de entrada (RF-119). */
export class QueryNotificationDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NotificationStatus })
  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  @ApiPropertyOptional({ enum: TYPES })
  @IsOptional()
  @IsIn(TYPES)
  type?: string;

  @ApiPropertyOptional({ description: 'Só o que ainda não foi lido' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsIn([true, false])
  unreadOnly?: boolean;
}

/**
 * Aviso escrito à mão (RF-119).
 *
 * Existe para o caso que nenhuma varredura cobre: o financeiro precisa avisar
 * três pessoas de que a conta muda de banco amanhã. O tipo continua vindo do
 * catálogo fechado — um tipo livre viraria classificação por digitação, e a
 * caixa de entrada deixaria de ser filtrável.
 *
 * Não há campo de destinatário por e-mail solto: quem recebe é usuário da
 * empresa, e o endereço vem do cadastro dele. Aceitar um endereço qualquer
 * transformaria a rota em relay de e-mail autenticado.
 */
export class CreateNotificationDto {
  @ApiProperty({ enum: TYPES })
  @IsIn(TYPES)
  type!: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @Length(3, 255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  title!: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @Length(3, 2000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  message!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, default: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  priority?: number;

  @ApiProperty({ description: 'Usuários da empresa que receberão o aviso', isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  userIds!: string[];

  @ApiPropertyOptional({ enum: SUPPORTED_CHANNELS, isArray: true, default: ['INTERNO'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SUPPORTED_CHANNELS.length)
  @IsIn(SUPPORTED_CHANNELS, { each: true })
  channels?: NotificationChannel[];

  @ApiPropertyOptional({ description: 'Tabela de `gestao` a que o aviso se refere' })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  entity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  entityId?: string;
}
