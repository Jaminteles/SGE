import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreatePartnerDto } from './create-partner.dto';

/**
 * O tipo de pessoa não é editável: trocá-lo invalidaria o documento já
 * cadastrado e o histórico fiscal ligado a ele. Cadastro errado se inativa e
 * se refaz.
 */
export class UpdatePartnerDto extends PartialType(OmitType(CreatePartnerDto, ['personType'])) {
  @ApiPropertyOptional({ description: 'Situação do parceiro (coluna `ativo`)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
