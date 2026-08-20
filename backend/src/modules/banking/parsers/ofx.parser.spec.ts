import { parseOfx } from './ofx.parser';
import { StatementParseError } from './statement.types';

/** OFX 1.x é SGML: as tags de valor não fecham. */
const OFX_SGML = `
OFXHEADER:100
DATA:OFXSGML
<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKTRANLIST>
<DTSTART>20261201000000[-3:BRT]
<DTEND>20261203235959[-3:BRT]
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261201120000[-3:BRT]
<TRNAMT>-1250.90
<FITID>202612010001
<MEMO>PAGAMENTO FORNECEDOR ACME
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261202090000[-3:BRT]
<TRNAMT>3400.00
<FITID>202612020007
<NAME>CLIENTE BETA LTDA
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>15320.10<DTASOF>20261203235959</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
`;

describe('parseOfx', () => {
  it('lê os lançamentos com sentido, valor absoluto e FITID', () => {
    const statement = parseOfx(OFX_SGML);

    expect(statement.entries).toHaveLength(2);
    expect(statement.entries[0]).toMatchObject({
      externalId: '202612010001',
      movementDate: '2026-12-01',
      direction: 'DEBITO',
      amount: '1250.90',
      description: 'PAGAMENTO FORNECEDOR ACME',
    });
    expect(statement.entries[1]).toMatchObject({
      externalId: '202612020007',
      direction: 'CREDITO',
      amount: '3400.00',
    });
  });

  it('preserva o valor como texto — sem passar por ponto flutuante', () => {
    const statement = parseOfx(OFX_SGML.replace('-1250.90', '-0.10'));

    expect(statement.entries[0].amount).toBe('0.10');
  });

  it('lê período e saldo final do arquivo', () => {
    const statement = parseOfx(OFX_SGML);

    expect(statement.periodStart).toBe('2026-12-01');
    expect(statement.periodEnd).toBe('2026-12-03');
    expect(statement.closingBalance).toBe('15320.10');
  });

  it('aceita a forma XML do OFX 2.x', () => {
    const xml = `<OFX><STMTTRN><DTPOSTED>2026-12-05</DTPOSTED><TRNAMT>-99.99</TRNAMT>
      <FITID>abc</FITID><MEMO>TARIFA</MEMO></STMTTRN></OFX>`;

    const statement = parseOfx(xml);

    expect(statement.entries[0]).toMatchObject({
      movementDate: '2026-12-05',
      direction: 'DEBITO',
      amount: '99.99',
    });
  });

  it('recusa arquivo sem lançamento — importar zero linhas é engano, não sucesso', () => {
    expect(() => parseOfx('<OFX></OFX>')).toThrow(StatementParseError);
  });
});
