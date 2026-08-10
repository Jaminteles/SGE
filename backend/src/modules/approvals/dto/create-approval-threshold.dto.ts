import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const MONEY_REGEX = /^\d{1,16}(\.\d{1,2})?$/;

/** Alçada de aprovação (RF-012) — `gestao.alcada` + `gestao.alcada_aprovador`. */
export class CreateApprovalThresholdDto {
  @ApiProperty({
    description: 'Tipo de operação sujeita à alçada',
    example: 'PAGAMENTO',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  operation!: string;

  @ApiPropertyOptional({ description: 'Nome da alçada. Padrão: a própria operação.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'Valor mínimo da faixa (decimal)', default: '0' })
  @IsOptional()
  @Matches(MONEY_REGEX, { message: 'minAmount deve ser um valor decimal válido' })
  minAmount?: string;

  @ApiPropertyOptional({ description: 'Valor máximo da faixa (decimal). Vazio = sem limite.' })
  @IsOptional()
  @Matches(MONEY_REGEX, { message: 'maxAmount deve ser um valor decimal válido' })
  maxAmount?: string;

  @ApiProperty({ description: 'Perfil autorizado a aprovar nessa faixa' })
  @IsUUID()
  requiredRoleId!: string;

  @ApiPropertyOptional({ default: 1, description: 'Nível da alçada (único por operação)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  level?: number;

  @ApiPropertyOptional({ default: 1, description: 'Quantidade mínima de aprovadores' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  minApprovers?: number;
}
