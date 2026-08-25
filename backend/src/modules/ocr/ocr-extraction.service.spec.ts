import { OcrExtractionService } from './ocr-extraction.service';

const service = new OcrExtractionService();

/** Cupom fiscal típico: razão social no topo, CNPJ, itens, total. */
const CUPOM = [
  'MERCADO SAO JOSE LTDA',
  'CNPJ: 11.222.333/0001-81',
  'Rua das Flores, 100 - Centro',
  'Data: 07/09/2026',
  'ARROZ 5KG          1  R$ 24,90',
  'FEIJAO 1KG         2  R$ 19,80',
  'SUBTOTAL                R$ 44,70',
  'VALOR TOTAL             R$ 1.244,70',
].join('\n');

describe('OcrExtractionService.extract', () => {
  it('lê valor, data, estabelecimento e documento de um cupom (RF-097)', () => {
    const fields = service.extract(CUPOM);

    expect(fields.amount?.toFixed(2)).toBe('1244.70');
    expect(fields.issueDate?.toISOString().slice(0, 10)).toBe('2026-09-07');
    expect(fields.merchantName).toBe('MERCADO SAO JOSE LTDA');
    expect(fields.merchantDocument).toBe('11222333000181');
  });

  it('prefere o rótulo mais específico ao primeiro número da página', () => {
    const fields = service.extract('SUBTOTAL R$ 44,70\nVALOR TOTAL R$ 1.244,70');

    expect(fields.amount?.toFixed(2)).toBe('1244.70');
  });

  it('lê o valor da linha seguinte quando o rótulo fica sozinho', () => {
    const fields = service.extract('TOTAL A PAGAR\n89,90');

    expect(fields.amount?.toFixed(2)).toBe('89.90');
  });

  it('entende as duas convenções de separador decimal', () => {
    expect(service.extract('TOTAL 1.234,56').amount?.toFixed(2)).toBe('1234.56');
    expect(service.extract('TOTAL 1,234.56').amount?.toFixed(2)).toBe('1234.56');
  });

  it('recusa documento com dígito verificador inválido', () => {
    const fields = service.extract('LOJA X\nCNPJ: 11.222.333/0001-99');

    expect(fields.merchantDocument).toBeUndefined();
  });

  it('aceita CPF de emitente pessoa física', () => {
    // 529.982.247-25 é um CPF válido de exemplo público.
    const fields = service.extract('RECIBO\nJOAO DA SILVA\nCPF 529.982.247-25\nTOTAL 50,00');

    expect(fields.merchantDocument).toBe('52998224725');
  });

  it('lê a chave de acesso de 44 dígitos, mesmo em blocos', () => {
    const chave = '3526 0911 2223 3300 0181 5500 1000 0012 3410 0000 1234';
    const fields = service.extract(`NFC-e\nCHAVE DE ACESSO\n${chave}`);

    expect(fields.documentKey).toBe(chave.replace(/\s/g, ''));
  });

  it('rejeita data impossível em vez de deixar o Date corrigir para março', () => {
    const fields = service.extract('Data: 31/02/2026');

    expect(fields.issueDate).toBeUndefined();
  });

  it('não inventa campo quando o texto não tem nada legível (RF-096)', () => {
    expect(service.extract('')).toEqual({});
    expect(service.extract('   \n  ')).toEqual({});
  });

  it('ignora o zero de rodapé: valor lido é valor pago', () => {
    const fields = service.extract('TOTAL R$ 0,00');

    expect(fields.amount).toBeUndefined();
  });

  it('não confunde rótulo com nome do estabelecimento', () => {
    const fields = service.extract('CUPOM FISCAL ELETRONICO\nPADARIA CENTRAL ME\nTOTAL 12,00');

    expect(fields.merchantName).toBe('PADARIA CENTRAL ME');
  });

  it('lê o número do documento quando ele vem rotulado', () => {
    const fields = service.extract('NOTA Nº 004512\nTOTAL 10,00');

    expect(fields.documentNumber).toBe('004512');
  });
});
