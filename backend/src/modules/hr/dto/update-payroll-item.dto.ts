import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreatePayrollItemDto } from './create-payroll-item.dto';

export class UpdatePayrollItemDto extends PartialType(CreatePayrollItemDto) {
  @ApiPropertyOptional({ description: 'Situação da verba (coluna `ativo`)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
