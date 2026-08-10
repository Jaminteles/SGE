import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateRoleDto } from './create-role.dto';

export class UpdateRoleDto extends PartialType(CreateRoleDto) {
  @ApiPropertyOptional({ description: 'Situação do perfil (coluna `ativo`)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
