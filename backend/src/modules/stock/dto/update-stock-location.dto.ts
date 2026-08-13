import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateStockLocationDto } from './create-stock-location.dto';

export class UpdateStockLocationDto extends PartialType(CreateStockLocationDto) {
  @ApiPropertyOptional({ description: 'Situação do local (coluna `ativo`)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
