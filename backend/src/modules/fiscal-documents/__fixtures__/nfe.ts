/**
 * XML de NF-e para os testes do M07. Fora do build (`tsconfig.build.json`).
 *
 * A chave é montada pelos mesmos campos que o parser confere contra ela — é o
 * que permite testar a divergência mudando um campo e mantendo a chave.
 */

export interface NfeFixtureOptions {
  uf?: string;
  yearMonth?: string;
  issuerTaxId?: string;
  modelCode?: string;
  series?: string;
  number?: string;
  /** Sobrescreve a chave calculada — usado para testar chave adulterada. */
  accessKey?: string;
  /** Conteúdo declarado, para divergir do que a chave diz. */
  contentNumber?: string;
  contentTaxId?: string;
  issuedAt?: string;
  productsAmount?: string;
  totalAmount?: string;
  items?: {
    code: string;
    description: string;
    quantity: string;
    unitPrice: string;
    total: string;
  }[];
  /** `cStat` do protocolo. `null` remove o protocolo (nota não transmitida). */
  protocolStatus?: string | null;
}

export function nfeAccessKey(options: NfeFixtureOptions = {}): string {
  const key43 =
    (options.uf ?? '35') +
    (options.yearMonth ?? '2611') +
    (options.issuerTaxId ?? '12345678000195').padStart(14, '0') +
    (options.modelCode ?? '55').padStart(2, '0') +
    (options.series ?? '1').padStart(3, '0') +
    (options.number ?? '4567').padStart(9, '0') +
    '1' +
    '12345678';

  return key43 + accessKeyDigit(key43);
}

export function accessKeyDigit(key43: string): string {
  let sum = 0;
  let weight = 2;
  for (let i = key43.length - 1; i >= 0; i--) {
    sum += Number(key43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder <= 1 ? '0' : String(11 - remainder);
}

export function nfeXml(options: NfeFixtureOptions = {}): string {
  const key = options.accessKey ?? nfeAccessKey(options);
  const items = options.items ?? [
    {
      code: 'CIM-01',
      description: 'Cimento CP-II 50kg',
      quantity: '10.0000',
      unitPrice: '38.5000',
      total: '385.00',
    },
    {
      code: 'ARE-01',
      description: 'Areia media m3',
      quantity: '4.0000',
      unitPrice: '90.0000',
      total: '360.00',
    },
  ];
  const products = options.productsAmount ?? '745.00';
  const total = options.totalAmount ?? '745.00';

  const details = items
    .map(
      (item, position) => `
      <det nItem="${position + 1}">
        <prod>
          <cProd>${item.code}</cProd>
          <xProd>${item.description}</xProd>
          <NCM>25232910</NCM>
          <CFOP>5102</CFOP>
          <uCom>UN</uCom>
          <qCom>${item.quantity}</qCom>
          <vUnCom>${item.unitPrice}</vUnCom>
          <vProd>${item.total}</vProd>
        </prod>
        <imposto>
          <ICMS>
            <ICMS00>
              <CST>00</CST>
              <vBC>${item.total}</vBC>
              <pICMS>18.0000</pICMS>
              <vICMS>${(Number(item.total) * 0.18).toFixed(2)}</vICMS>
            </ICMS00>
          </ICMS>
          <PIS><PISAliq><vPIS>1.00</vPIS></PISAliq></PIS>
          <COFINS><COFINSAliq><vCOFINS>4.60</vCOFINS></COFINSAliq></COFINS>
        </imposto>
      </det>`,
    )
    .join('');

  const protocol =
    options.protocolStatus === null
      ? ''
      : `<protNFe versao="4.00">
           <infProt>
             <chNFe>${key}</chNFe>
             <nProt>135260000012345</nProt>
             <cStat>${options.protocolStatus ?? '100'}</cStat>
             <xMotivo>Autorizado o uso da NF-e</xMotivo>
             <dhRecbto>2026-11-30T10:05:00-03:00</dhRecbto>
           </infProt>
         </protNFe>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe${key}" versao="4.00">
      <ide>
        <cUF>${options.uf ?? '35'}</cUF>
        <natOp>Compra para revenda</natOp>
        <mod>${options.modelCode ?? '55'}</mod>
        <serie>${options.series ?? '1'}</serie>
        <nNF>${options.contentNumber ?? options.number ?? '4567'}</nNF>
        <dhEmi>${options.issuedAt ?? '2026-11-30T09:00:00-03:00'}</dhEmi>
        <tpNF>0</tpNF>
      </ide>
      <emit>
        <CNPJ>${options.contentTaxId ?? options.issuerTaxId ?? '12345678000195'}</CNPJ>
        <xNome>Fornecedora de Materiais LTDA</xNome>
      </emit>
      <dest>
        <CNPJ>98765432000188</CNPJ>
        <xNome>Construtora Exemplo SA</xNome>
      </dest>${details}
      <total>
        <ICMSTot>
          <vProd>${products}</vProd>
          <vDesc>0.00</vDesc>
          <vFrete>0.00</vFrete>
          <vSeg>0.00</vSeg>
          <vOutro>0.00</vOutro>
          <vICMS>134.10</vICMS>
          <vST>0.00</vST>
          <vIPI>0.00</vIPI>
          <vPIS>2.00</vPIS>
          <vCOFINS>9.20</vCOFINS>
          <vNF>${total}</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
  ${protocol}
</nfeProc>`;
}
