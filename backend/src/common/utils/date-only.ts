import { applyDecorators } from '@nestjs/common';
import { Matches } from 'class-validator';

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Datas de RH (admissão, vigência, despesa) são colunas `date` no banco:
 * dia civil, sem hora e sem fuso. Trafegar `2026-09-07` e converter para meia-
 * noite UTC evita o clássico de a data "andar" um dia conforme o fuso de quem
 * envia — o que em admissão e vigência de verba muda o mês de competência.
 */
export function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Formata uma coluna `date` de volta como dia civil. */
export function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Valida o formato `YYYY-MM-DD` num campo de DTO. */
export function IsDateOnly(): PropertyDecorator {
  return applyDecorators(
    Matches(DATE_ONLY_PATTERN, { message: '$property deve estar no formato YYYY-MM-DD' }),
  );
}
