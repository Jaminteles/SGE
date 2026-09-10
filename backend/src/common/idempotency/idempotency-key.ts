import { BadRequestException } from '@nestjs/common';

/** Header em que o cliente informa a chave da operação (RF-067). */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

export const MIN_IDEMPOTENCY_KEY = 8;
export const MAX_IDEMPOTENCY_KEY = 255;

/**
 * Valida a `Idempotency-Key` de uma operação que move dinheiro.
 *
 * A chave é escolhida pelo cliente, e por isso é validada na entrada: chave
 * curta demais colide entre operações diferentes e transformaria a proteção
 * contra duplicidade em causa de duplicidade. É obrigatória — opcional, ela
 * falta justamente no cliente que mais precisaria dela.
 *
 * @param operacao complemento da mensagem, ex.: "no registro de baixas".
 */
export function requireIdempotencyKey(value: string | undefined, operacao: string): string {
  const key = value?.trim();
  if (!key) {
    throw new BadRequestException(`O header Idempotency-Key é obrigatório ${operacao}.`);
  }
  if (key.length < MIN_IDEMPOTENCY_KEY || key.length > MAX_IDEMPOTENCY_KEY) {
    throw new BadRequestException(
      `O header Idempotency-Key deve ter entre ${MIN_IDEMPOTENCY_KEY} e ${MAX_IDEMPOTENCY_KEY} caracteres.`,
    );
  }
  return key;
}
