import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateCostCenterDto } from './create-cost-center.dto';

export class UpdateCostCenterDto extends PartialType(CreateCostCenterDto) {
  @ApiPropertyOptional({ description: 'Situação do centro de custo (coluna `ativo`)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
