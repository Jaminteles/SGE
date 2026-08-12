import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreatePaymentTermDto } from './create-payment-term.dto';

export class UpdatePaymentTermDto extends PartialType(CreatePaymentTermDto) {
  @ApiPropertyOptional({ description: 'Situação da condição de pagamento (coluna `ativo`)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
