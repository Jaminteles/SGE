import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateCompanyAccountDto } from './create-company-account.dto';

/**
 * Banco, agência e conta ficam de fora da alteração: os três formam a
 * identidade da conta (`uq_conta_bancaria`) e são referenciados por transações,
 * extratos e baixas já lançados. Trocar um deles é abrir outra conta — e manter
 * a antiga com o histórico que ela produziu.
 */
export class UpdateCompanyAccountDto extends PartialType(
  OmitType(CreateCompanyAccountDto, ['bankCode', 'agency', 'account'] as const),
) {
  @ApiPropertyOptional({ description: 'Situação da conta (coluna `ativo`)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
