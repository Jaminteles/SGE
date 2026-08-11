import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HrEventType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { IsMoney } from '../../../common/validators/decimal.decorator';
import { IsDateOnly } from '../../../common/utils/date-only';

/**
 * Evento do histórico funcional (RF-015, RF-020) — `gestao.funcionario_evento`.
 *
 * ADMISSAO e DESLIGAMENTO não são aceitos aqui: o primeiro nasce da criação do
 * funcionário e o segundo de `POST /employees/:id/terminate`, que ainda registra
 * o motivo. Dois caminhos para o mesmo fato produziriam históricos duplicados.
 */
export class CreateEmployeeEventDto {
  @ApiProperty({
    enum: HrEventType,
    description: 'Férias, afastamento, retorno, promoção, transferência ou alteração salarial',
  })
  @IsEnum(HrEventType)
  type!: HrEventType;

  @ApiProperty({ description: 'Início do evento (YYYY-MM-DD)' })
  @IsDateOnly()
  startDate!: string;

  @ApiPropertyOptional({ description: 'Fim do evento (YYYY-MM-DD), quando previsto' })
  @IsOptional()
  @IsDateOnly()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Novo cargo (promoção)' })
  @IsOptional()
  @IsUUID()
  positionId?: string;

  @ApiPropertyOptional({ description: 'Novo departamento (transferência)' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Novo centro de custo (RF-016)' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional({ description: 'Novo salário (decimal) — RF-017' })
  @IsOptional()
  @IsMoney()
  salary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
