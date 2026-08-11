import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsMoney } from '../../../common/validators/decimal.decorator';

/** Aprovação de reembolso (RF-018, RN-003). */
export class ApproveReimbursementDto {
  @ApiPropertyOptional({
    description: 'Valor aprovado (decimal). Padrão: o total solicitado. Nunca maior que ele.',
  })
  @IsOptional()
  @IsMoney()
  approvedAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/** Reprovação de reembolso: o motivo é obrigatório e vai para a trilha. */
export class RejectReimbursementDto {
  @ApiPropertyOptional({ description: 'Motivo da reprovação' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}
