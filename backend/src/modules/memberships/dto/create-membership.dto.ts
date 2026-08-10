import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class CreateMembershipDto {
  @ApiProperty({ description: 'Usuário a ser associado à empresa' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ description: 'Perfil de acesso na empresa' })
  @IsUUID()
  roleId!: string;

  @ApiPropertyOptional({ description: 'Filial do vínculo. Vazio = todas as filiais.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ default: false, description: 'Empresa padrão do usuário' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Situação do vínculo (coluna `ativo`)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
