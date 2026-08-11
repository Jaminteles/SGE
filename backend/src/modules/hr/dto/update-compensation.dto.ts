import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateCompensationDto } from './create-compensation.dto';

/**
 * A verba em si não muda: trocá-la seria outra atribuição, com outra vigência.
 * Editar valor, percentual ou período continua permitido enquanto a folha da
 * competência não foi fechada (M14, sprint futura).
 */
export class UpdateCompensationDto extends PartialType(
  OmitType(CreateCompensationDto, ['payrollItemId'] as const),
) {}
