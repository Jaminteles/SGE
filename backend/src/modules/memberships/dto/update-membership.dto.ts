import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class UpdateMembershipDto {
  @ApiPropertyOptional({ description: 'Novo perfil de acesso' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ description: 'Filial do vínculo. Vazio = todas as filiais.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Empresa padrão do usuário' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'Situação do vínculo (coluna `ativo`)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
