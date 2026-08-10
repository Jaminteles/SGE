import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateApprovalThresholdDto } from './create-approval-threshold.dto';

export class UpdateApprovalThresholdDto extends PartialType(CreateApprovalThresholdDto) {
  @ApiPropertyOptional({ description: 'Situação da alçada (coluna `ativo`)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
