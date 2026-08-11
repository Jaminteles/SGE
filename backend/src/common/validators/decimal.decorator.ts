import { applyDecorators } from '@nestjs/common';
import { Matches } from 'class-validator';

/**
 * Valores monetários trafegam como string decimal (RN-012).
 *
 * `number` em JSON é ponto flutuante binário: 0.1 + 0.2 já não fecha, e a
 * conversão para `numeric(18,2)` do banco aconteceria depois do estrago. A
 * string chega intacta ao `Prisma.Decimal`.
 */
export const MONEY_PATTERN = /^-?\d{1,16}(\.\d{1,2})?$/;
/** `dom_percentual` é numeric(9,6): até 100.000000 nas verbas proporcionais. */
export const PERCENTAGE_PATTERN = /^(100(\.0{1,6})?|\d{1,2}(\.\d{1,6})?)$/;

export function IsMoney(): PropertyDecorator {
  return applyDecorators(
    Matches(MONEY_PATTERN, { message: '$property deve ser um valor decimal com até 2 casas' }),
  );
}

export function IsPercentage(): PropertyDecorator {
  return applyDecorators(
    Matches(PERCENTAGE_PATTERN, {
      message: '$property deve ser um percentual de 0 a 100 com até 6 casas',
    }),
  );
}
