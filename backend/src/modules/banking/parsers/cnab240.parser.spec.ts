import { isCnab240, parseCnab240 } from './cnab240.parser';
import { StatementParseError } from './statement.types';

/** Monta um registro de 240 posições colocando cada campo na coluna 1-based. */
function record(fields: Record<number, string>): string {
  const line = new Array<string>(240).fill(' ');
  for (const [position, value] of Object.entries(fields)) {
    const start = Number(position) - 1;
    for (let i = 0; i < value.length; i += 1) {
      line[start + i] = value[i];
    }
  }
  return line.join('');
}

const header = record({ 8: '0' });

function detail(options: {
  date: string;
  amount: string;
  direction: 'D' | 'C';
  document?: string;
  description?: string;
}): string {
  return record({
    8: '3',
    14: 'E',
    155: options.date,
    163: options.amount,
    181: options.direction,
    196: options.document ?? '',
    211: options.description ?? '',
  });
}

describe('parseCnab240', () => {
  it('lê o segmento E convertendo DDMMAAAA e os centavos implícitos', () => {
    const file = [
      header,
      detail({
        date: '05082026',
        amount: '000000000000150000',
        direction: 'C',
        document: '000000000001234',
        description: 'CREDITO PIX ACME',
      }),
    ].join('\n');

    const parsed = parseCnab240(file);

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toMatchObject({
      movementDate: '2026-08-05',
      direction: 'CREDITO',
      amount: '1500.00',
      document: '1234',
      description: 'CREDITO PIX ACME',
    });
    expect(parsed.periodStart).toBe('2026-08-05');
    expect(parsed.periodEnd).toBe('2026-08-05');
  });

  it('usa o indicador D/C do layout como sentido, e não o sinal do valor', () => {
    const file = [
      header,
      detail({ date: '05082026', amount: '000000000000009900', direction: 'D' }),
    ].join('\n');

    expect(parseCnab240(file).entries[0]).toMatchObject({
      direction: 'DEBITO',
      amount: '99.00',
    });
  });

  it('lê os saldos do trailer de lote, respeitando o indicador de posição', () => {
    const trailer = record({
      8: '5',
      42: '000000000000100000',
      60: 'C',
      61: '000000000000050000',
      79: 'D',
    });

    const file = [
      header,
      detail({ date: '05082026', amount: '000000000000050000', direction: 'D' }),
      trailer,
    ].join('\n');

    const parsed = parseCnab240(file);

    expect(parsed.openingBalance).toBe('1000.00');
    expect(parsed.closingBalance).toBe('-500.00');
  });

  it('recusa a linha mais curta que o layout em vez de recortar campo errado', () => {
    const truncated = detail({
      date: '05082026',
      amount: '000000000000150000',
      direction: 'C',
    }).slice(0, 200);

    expect(() => parseCnab240([header, truncated].join('\n'))).toThrow(StatementParseError);
  });

  it('recusa data inválida citando a linha', () => {
    const file = [
      header,
      detail({ date: '00000000', amount: '000000000000150000', direction: 'C' }),
    ].join('\n');

    expect(() => parseCnab240(file)).toThrow(/linha 2/i);
  });

  it('ignora segmentos que não são de extrato e reclama quando não sobra nada', () => {
    const cobranca = record({ 8: '3', 14: 'T' });

    expect(() => parseCnab240([header, cobranca].join('\n'))).toThrow(/segmento E/i);
  });

  it('reconhece o arquivo pelo registro de cabeçalho', () => {
    expect(isCnab240([header, detail({ date: '05082026', amount: '000000000000000100', direction: 'C' })].join('\n'))).toBe(true);
    expect(isCnab240('data;valor\n2026-08-05;150,00')).toBe(false);
  });
});
