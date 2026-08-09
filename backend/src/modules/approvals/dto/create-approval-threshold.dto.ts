import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const MONEY_REGEX = /^\d{1,16}(\.\d{1,2})?$/;

export class CreateApprovalThresholdDto {
  @ApiProperty({ description: 'Chave da operação crítica', example: 'payments:create' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  operation!: string;

  @ApiPropertyOptional({ description: 'Valor mínimo da faixa (decimal)', default: '0' })
  @IsOptional()
  @Matches(MONEY_REGEX, { message: 'minAmount deve ser um valor decimal válido' })
  minAmount?: string;

  @ApiPropertyOptional({ description: 'Valor máximo da faixa (decimal). Vazio = sem limite.' })
  @IsOptional()
  @Matches(MONEY_REGEX, { message: 'maxAmount deve ser um valor decimal válido' })
  maxAmount?: string;

  @ApiProperty({ description: 'Perfil autorizado a aprovar nessa faixa' })
  @IsString()
  requiredRoleId!: string;
}
