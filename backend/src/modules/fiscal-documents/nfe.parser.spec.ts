import { BadRequestException } from '@nestjs/common';
import { FiscalDocumentModel } from '@prisma/client';
import { authorizationIssue, parseNfeXml } from './nfe.parser';
import { nfeAccessKey, nfeXml } from './__fixtures__/nfe';

describe('parseNfeXml', () => {
  it('lê cabeçalho, totais e itens da NF-e autorizada', () => {
    const parsed = parseNfeXml(nfeXml());

    expect(parsed.model).toBe(FiscalDocumentModel.NFE);
    expect(parsed.accessKey).toBe(nfeAccessKey());
    expect(parsed.number).toBe('4567');
    expect(parsed.issuerTaxId).toBe('12345678000195');
    expect(parsed.recipientTaxId).toBe('98765432000188');
    expect(parsed.totalAmount.toFixed(2)).toBe('745.00');
    expect(parsed.metadata.protocolStatus).toBe('100');
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].description).toBe('Cimento CP-II 50kg');
    expect(parsed.items[0].icmsCst).toBe('00');
    expect(parsed.items[0].icmsAmount.toFixed(2)).toBe('69.30');
  });

  // O total da linha que o modelo guarda é líquido de desconto e acrescido do
  // frete rateado pelo emitente — é a composição que bd/12 confere.
  it('compõe o total da linha com desconto e frete do item', () => {
    const xml = nfeXml().replace(
      '<vProd>385.00</vProd>',
      '<vProd>385.00</vProd><vDesc>5.00</vDesc><vFrete>10.00</vFrete>',
    );

    const [first] = parseNfeXml(xml).items;

    expect(first.discountAmount.toFixed(2)).toBe('5.00');
    expect(first.lineAmount.toFixed(2)).toBe('390.00');
  });

  // A chave carrega CNPJ, modelo, série e número: divergir dela é o sinal do XML
  // editado à mão, em que alguém muda a nota mas não consegue refazer a chave.
  it('recusa XML cujo conteúdo não corresponde à chave de acesso', () => {
    expect(() => parseNfeXml(nfeXml({ contentNumber: '9999' }))).toThrow(BadRequestException);
    expect(() => parseNfeXml(nfeXml({ contentTaxId: '11222333000181' }))).toThrow(
      BadRequestException,
    );
  });

  it('recusa chave de acesso com dígito verificador errado', () => {
    const tampered = nfeAccessKey().slice(0, 43) + '0';
    const xml = nfeXml({ accessKey: tampered });

    // A chave adulterada é recusada antes de qualquer conferência de conteúdo.
    expect(() => parseNfeXml(xml)).toThrow(/dígito verificador/);
  });

  it('recusa modelo e raiz fora de NF-e/NFC-e', () => {
    expect(() => parseNfeXml(nfeXml({ modelCode: '57' }))).toThrow(/não suportado/);
    expect(() => parseNfeXml('<CTe><infCte/></CTe>')).toThrow(/não suportado/);
  });

  it('recusa valor não numérico e valor negativo', () => {
    expect(() => parseNfeXml(nfeXml().replace('<vNF>745.00</vNF>', '<vNF>abc</vNF>'))).toThrow(
      BadRequestException,
    );
    expect(() => parseNfeXml(nfeXml().replace('<vNF>745.00</vNF>', '<vNF>-1.00</vNF>'))).toThrow(
      BadRequestException,
    );
  });

  it('recusa nota sem itens', () => {
    expect(() => parseNfeXml(nfeXml({ items: [] }))).toThrow(/sem itens/);
  });
});

describe('authorizationIssue', () => {
  it('não aponta problema na nota autorizada', () => {
    expect(authorizationIssue(parseNfeXml(nfeXml({ protocolStatus: '100' })))).toBeUndefined();
  });

  // Nota cancelada ou denegada não pode virar estoque nem título a pagar: o
  // protocolo é a única coisa no arquivo que diz se ela vale.
  it('aponta o cStat quando a nota não está autorizada', () => {
    expect(authorizationIssue(parseNfeXml(nfeXml({ protocolStatus: '110' })))).toMatch('110');
  });

  it('não aponta problema quando o XML não traz protocolo', () => {
    expect(authorizationIssue(parseNfeXml(nfeXml({ protocolStatus: null })))).toBeUndefined();
  });
});
