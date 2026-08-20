import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateCredentialDto } from './create-credential.dto';

/**
 * Provedor e ambiente não mudam: os dois compõem a chave (`uq_credencial`) e
 * apontam para contas bancárias já configuradas. Trocar de provedor é cadastrar
 * outra credencial e reapontar a conta — com rastro de quando isso aconteceu.
 *
 * `secret` continua aceito: rotacionar segredo é operação normal, e ela
 * sobrescreve o valor cifrado sem nunca expor o anterior.
 */
export class UpdateCredentialDto extends PartialType(
  OmitType(CreateCredentialDto, ['providerId', 'environment'] as const),
) {}
