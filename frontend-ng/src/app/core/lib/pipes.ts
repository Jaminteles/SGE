import { Pipe, PipeTransform } from '@angular/core';

import { formatCurrency, formatDecimal, formatInteger, formatPercent } from './decimal';
import { formatCnpj, formatDate, formatDateTime } from './format';

/**
 * Formatação pt-BR para os templates (RN-012 — UI-084).
 *
 * Os pipes nativos do Angular (`currency`, `number`, `date`) recebem `number` e
 * `Date`. Passar por eles significaria converter o `numeric(18,2)` que a API
 * manda como **string** em ponto flutuante binário só para exibir — e a partir
 * daí "1.234,56" na tela deixaria de ser garantidamente o que está no banco.
 *
 * Por isso estes pipes só delegam para as funções de `core/lib/decimal` e
 * `core/lib/format`, que trabalham sobre a string canônica do começo ao fim.
 * Eles são `pure` (o padrão): o mesmo valor não é reformatado a cada ciclo de
 * detecção de mudanças.
 *
 * Os módulos já entregues chamam as funções direto do TypeScript; os pipes
 * existem para o que é formatado no próprio template, sem um `computed` no
 * meio do caminho. As duas rotas usam a mesma implementação.
 */

/** `"1234.5" | sgeMoeda` -> `"R$ 1.234,50"`. */
@Pipe({ name: 'sgeMoeda' })
export class MoedaPipe implements PipeTransform {
  transform(valor: string | null | undefined): string {
    return formatCurrency(valor);
  }
}

/**
 * `"1234.5" | sgeDecimal` -> `"1.234,50"`.
 *
 * `casas` é o máximo exibido, nunca o mínimo — quantidade de estoque chega com
 * até seis casas e truncar em duas esconderia fração de unidade real.
 */
@Pipe({ name: 'sgeDecimal' })
export class DecimalPtPipe implements PipeTransform {
  transform(valor: string | null | undefined, casas = 2): string {
    return formatDecimal(valor, casas);
  }
}

/** `"1234567" | sgeInteiro` -> `"1.234.567"`. */
@Pipe({ name: 'sgeInteiro' })
export class InteiroPipe implements PipeTransform {
  transform(valor: string | number | null | undefined): string {
    return formatInteger(valor);
  }
}

/** `"18.500000" | sgePercentual` -> `"18,5%"`. */
@Pipe({ name: 'sgePercentual' })
export class PercentualPipe implements PipeTransform {
  transform(valor: string | null | undefined): string {
    return formatPercent(valor);
  }
}

/**
 * `"2026-08-10" | sgeData` -> `"10/08/2026"`.
 *
 * Lê os dígitos da própria string em vez de construir um `Date`: `new
 * Date('2026-08-10')` é meia-noite **UTC**, e no fuso de Brasília isso volta
 * como 09/08. Data de vencimento não pode andar um dia para trás na tela.
 */
@Pipe({ name: 'sgeData' })
export class DataPipe implements PipeTransform {
  transform(valor: string | null | undefined): string {
    return formatDate(valor);
  }
}

/** `"2026-08-10T14:35:00Z" | sgeDataHora` -> `"10/08/2026 11:35"` (fuso local). */
@Pipe({ name: 'sgeDataHora' })
export class DataHoraPipe implements PipeTransform {
  transform(valor: string | null | undefined): string {
    return formatDateTime(valor);
  }
}

/** `"12345678000190" | sgeCnpj` -> `"12.345.678/0001-90"`. */
@Pipe({ name: 'sgeCnpj' })
export class CnpjPipe implements PipeTransform {
  transform(valor: string | null | undefined): string {
    return formatCnpj(valor);
  }
}

/** Conjunto pronto para o `imports` de um componente standalone. */
export const FORMATO_PIPES = [
  MoedaPipe,
  DecimalPtPipe,
  InteiroPipe,
  PercentualPipe,
  DataPipe,
  DataHoraPipe,
  CnpjPipe,
] as const;
