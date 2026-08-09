import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { RecordStatus } from '@prisma/client';

export class CreateMembershipDto {
  @ApiProperty({ description: 'Usuário a ser associado à empresa' })
  @IsString()
  userId!: string;

  @ApiProperty({ description: 'Perfil de acesso na empresa' })
  @IsString()
  roleId!: string;

  @ApiPropertyOptional({ enum: RecordStatus, default: RecordStatus.ACTIVE })
  @IsOptional()
  @IsEnum(RecordStatus)
  status?: RecordStatus;
}
