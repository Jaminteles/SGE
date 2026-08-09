import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateCompanyDto } from './create-company.dto';

/**
 * Atualização dos dados cadastrais (RF-003). O CNPJ é imutável após a criação
 * por ser a identidade fiscal da empresa.
 */
export class UpdateCompanyDto extends PartialType(OmitType(CreateCompanyDto, ['taxId'] as const)) {}
