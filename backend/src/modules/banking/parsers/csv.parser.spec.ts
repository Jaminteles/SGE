import { parseCsv } from './csv.parser';
import { StatementParseError } from './statement.types';

describe('parseCsv', () => {
  it('lê o formato brasileiro: ponto e vírgula, data dd/mm/aaaa e vírgula decimal', () => {
    const csv = [
      'Data;Histórico;Documento;Valor',
      '01/12/2026;PAGAMENTO FORNECEDOR;DOC123;-1.250,90',
      '02/12/2026;RECEBIMENTO CLIENTE;DOC124;3.400,00',
    ].join('\n');

    const statement = parseCsv(csv);

    expect(statement.entries).toEqual([
      expect.objectContaining({
        movementDate: '2026-12-01',
        direction: 'DEBITO',
        amount: '1250.90',
        description: 'PAGAMENTO FORNECEDOR',
        document: 'DOC123',
      }),
      expect.objectContaining({
        movementDate: '2026-12-02',
        direction: 'CREDITO',
        amount: '3400.00',
      }),
    ]);
    expect(statement.periodStart).toBe('2026-12-01');
    expect(statement.periodEnd).toBe('2026-12-02');
  });

  it('respeita a coluna de tipo quando ela existe, mesmo com valor sem sinal', () => {
    const csv = ['data,valor,tipo,descricao', '2026-12-01,150.00,D,TARIFA MENSAL'].join('\n');

    expect(parseCsv(csv).entries[0]).toMatchObject({ direction: 'DEBITO', amount: '150.00' });
  });

  it('não quebra a linha em separador dentro de aspas', () => {
    const csv = ['data;valor;descricao', '01/12/2026;-10,00;"TARIFA; PACOTE MENSAL"'].join('\n');

    expect(parseCsv(csv).entries[0].description).toBe('TARIFA; PACOTE MENSAL');
  });

  it('reconhece o identificador do banco para deduplicar reimportações', () => {
    const csv = ['data;valor;identificador', '01/12/2026;-10,00;FIT-99'].join('\n');

    expect(parseCsv(csv).entries[0].externalId).toBe('FIT-99');
  });

  it('recusa arquivo sem coluna de valor em vez de importar linhas vazias', () => {
    const csv = ['data;descricao', '01/12/2026;ALGO'].join('\n');

    expect(() => parseCsv(csv)).toThrow(StatementParseError);
  });

  it('cita a linha quando o valor não é decimal — extrato com linha perdida é pior', () => {
    const csv = ['data;valor', '01/12/2026;mil reais'].join('\n');

    expect(() => parseCsv(csv)).toThrow(/Linha 2/);
  });

  it('recusa data em formato desconhecido', () => {
    const csv = ['data;valor', '2026.12.01;-10,00'].join('\n');

    expect(() => parseCsv(csv)).toThrow(StatementParseError);
  });
});
