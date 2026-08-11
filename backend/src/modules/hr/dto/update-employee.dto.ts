import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateEmployeeDto } from './create-employee.dto';

/**
 * Edição do cadastro funcional (RF-013).
 *
 * `hireDate` e `baseSalary` ficam de fora: admissão e alteração salarial são
 * eventos do histórico (RF-015/RF-017) e é de lá que o cadastro é atualizado —
 * permitir os dois caminhos deixaria cadastro e histórico divergentes. Situação
 * e data de desligamento, pelo mesmo motivo, também não entram aqui.
 */
export class UpdateEmployeeDto extends PartialType(
  OmitType(CreateEmployeeDto, ['hireDate', 'baseSalary'] as const),
) {}
