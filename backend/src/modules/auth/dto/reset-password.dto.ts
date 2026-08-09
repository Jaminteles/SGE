import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { IsStrongPassword } from '../../../common/validators/password.decorator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token de recuperação recebido por e-mail' })
  @IsString()
  token!: string;

  @ApiProperty()
  @IsStrongPassword()
  newPassword!: string;
}
