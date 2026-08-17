import { BadRequestException } from '@nestjs/common';
import { FiscalDocumentModel, Prisma } from '@prisma/client';
import { child, children, parseXml, text, XmlNode } from '../../common/xml/xml-reader';
import { MAX_ITEMS_PER_DOCUMENT } from './fiscal-documents.constants';

/** Linha da nota, já normalizada para o modelo (RF-045). */
export interface ParsedFiscalItem {
  sequence: number;
  supplierCode?: string;
  description: string;
  ncm?: string;
  cest?: string;
  cfop?: string;
  unit?: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  freightAmount: Prisma.Decimal;
  lineAmount: Prisma.Decimal;
  icmsCst?: string;
  icmsBase: Prisma.Decimal;
  icmsRate: Prisma.Decimal;
  icmsAmount: Prisma.Decimal;
  icmsStAmount: Prisma.Decimal;
  ipiAmount: Prisma.Decimal;
  pisAmount: Prisma.Decimal;
  cofinsAmount: Prisma.Decimal;
}

/** Documento lido do XML (RF-045). Nada aqui vem do cliente da API. */
export interface ParsedFiscalDocument {
  model: FiscalDocumentModel;
  accessKey: string;
  number: string;
  series?: string;
  operationType?: string;
  operationNature?: string;
  issuedAt: Date;
  movedAt?: Date;
  issuerTaxId: string;
  issuerName?: string;
  recipientTaxId?: string;
  recipientName?: string;
  productsAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  freightAmount: Prisma.Decimal;
  insuranceAmount: Prisma.Decimal;
  otherExpenseAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  icmsAmount: Prisma.Decimal;
  icmsStAmount: Prisma.Decimal;
  ipiAmount: Prisma.Decimal;
  pisAmount: Prisma.Decimal;
  cofinsAmount: Prisma.Decimal;
  /** Versão do layout, protocolo de autorização e o que mais vier do XML. */
  metadata: Prisma.JsonObject;
  items: ParsedFiscalItem[];
}

/** `mod` do XML → modelo do documento. Só estes dois são lidos aqui. */
const MODELS: Record<string, FiscalDocumentModel> = {
  '55': FiscalDocumentModel.NFE,
  '65': FiscalDocumentModel.NFCE,
};

/**
 * `cStat` que autoriza a nota: 100 (autorizada) e 150 (autorizada fora do
 * prazo). Qualquer outro código — cancelada, denegada, rejeitada — é motivo para
 * o documento **não** virar estoque nem título.
 */
const AUTHORIZED_STATUS = new Set(['100', '150']);

/** Grupos de ICMS possíveis em `imposto > ICMS` (regime normal e Simples). */
const ICMS_GROUPS = [
  'ICMS00',
  'ICMS10',
  'ICMS20',
  'ICMS30',
  'ICMS40',
  'ICMS51',
  'ICMS60',
  'ICMS70',
  'ICMS90',
  'ICMSPart',
  'ICMSST',
  'ICMSSN101',
  'ICMSSN102',
  'ICMSSN201',
  'ICMSSN202',
  'ICMSSN500',
  'ICMSSN900',
];

const ZERO = new Prisma.Decimal(0);

/**
 * Leitura de NF-e / NFC-e (RF-043/RF-045).
 *
 * Aceita o XML autorizado (`nfeProc`) e o da nota isolada (`NFe`). Outros
 * modelos — NFS-e municipal, CT-e, MDF-e — têm layout próprio e entram com o
 * M12 (Fiscal): recusar aqui é melhor do que gravar um documento cujos campos
 * ninguém preencheu.
 *
 * Duas conferências de integridade acontecem antes de qualquer gravação, e as
 * duas usam a própria chave de acesso, que carrega os dados da nota nos seus 44
 * dígitos:
 *
 *  - **dígito verificador** (módulo 11): chave digitada errada ou truncada para
 *    aqui em vez de virar um documento que nunca será reconciliado com a SEFAZ;
 *  - **coerência com o conteúdo**: CNPJ do emitente, modelo, série e número do
 *    XML têm de ser os mesmos que estão dentro da chave. É a checagem que
 *    percebe o XML editado à mão — o caso em que alguém troca o valor de uma
 *    nota mas não consegue refazer a chave.
 *
 * O parser não decide nada sobre o documento: ele lê, confere e devolve. Quem
 * grava, deduplica e vincula é o service.
 */
export function parseNfeXml(source: string): ParsedFiscalDocument {
  const root = parseXml(source);

  // `nfeProc` embrulha a nota autorizada junto com o protocolo.
  const nfe = root.name === 'nfeProc' ? child(root, 'NFe') : root.name === 'NFe' ? root : undefined;
  if (!nfe) {
    throw unsupported(
      `raiz \`${root.name}\` não é NF-e nem NFC-e. NFS-e, CT-e e MDF-e entram com o M12`,
    );
  }

  const info = child(nfe, 'infNFe');
  const ide = child(info, 'ide');
  if (!info || !ide) {
    throw unsupported('XML sem o grupo `infNFe`/`ide`');
  }

  const modelCode = required(text(ide, 'mod'), 'ide/mod');
  const model = MODELS[modelCode];
  if (!model) {
    throw unsupported(`modelo ${modelCode} não é NF-e (55) nem NFC-e (65)`);
  }

  const accessKey = readAccessKey(info);
  const number = required(text(ide, 'nNF'), 'ide/nNF');
  const series = text(ide, 'serie');
  const issuerTaxId = taxId(text(child(info, 'emit'), 'CNPJ') ?? text(child(info, 'emit'), 'CPF'));
  if (!issuerTaxId) {
    throw invalid('nota sem CNPJ/CPF do emitente (RF-045)');
  }

  assertKeyMatchesContent(accessKey, {
    modelCode,
    number,
    series: series ?? '0',
    issuerTaxId,
  });

  const totals = child(info, 'total', 'ICMSTot');
  const items = readItems(info);
  const protocol = readProtocol(root);

  return {
    model,
    accessKey,
    number,
    series,
    operationType: text(ide, 'tpNF'),
    operationNature: text(ide, 'natOp'),
    issuedAt: readDate(required(text(ide, 'dhEmi') ?? text(ide, 'dEmi'), 'ide/dhEmi')),
    movedAt: optionalDate(text(ide, 'dhSaiEnt') ?? text(ide, 'dSaiEnt')),
    issuerTaxId,
    issuerName: text(child(info, 'emit'), 'xNome'),
    recipientTaxId: taxId(text(child(info, 'dest'), 'CNPJ') ?? text(child(info, 'dest'), 'CPF')),
    recipientName: text(child(info, 'dest'), 'xNome'),
    productsAmount: money(totals, 'vProd'),
    discountAmount: money(totals, 'vDesc'),
    freightAmount: money(totals, 'vFrete'),
    insuranceAmount: money(totals, 'vSeg'),
    otherExpenseAmount: money(totals, 'vOutro'),
    totalAmount: money(totals, 'vNF'),
    icmsAmount: money(totals, 'vICMS'),
    icmsStAmount: money(totals, 'vST'),
    ipiAmount: money(totals, 'vIPI'),
    pisAmount: money(totals, 'vPIS'),
    cofinsAmount: money(totals, 'vCOFINS'),
    metadata: {
      layoutVersion: info.attributes.versao ?? null,
      ...protocol,
    },
    items,
  };
}

/**
 * A nota está autorizada? (RF-045/RF-047)
 *
 * Sem protocolo — XML da nota isolada, ainda não transmitida — não há como
 * afirmar que está: o documento entra, mas quem decide o que fazer com ele é o
 * service. Com protocolo, vale o `cStat`.
 */
export function authorizationIssue(parsed: ParsedFiscalDocument): string | undefined {
  const status = parsed.metadata.protocolStatus;
  if (typeof status !== 'string') return undefined;
  if (AUTHORIZED_STATUS.has(status)) return undefined;

  const reason = parsed.metadata.protocolReason;
  return `Protocolo da SEFAZ com cStat ${status}${typeof reason === 'string' ? ` (${reason})` : ''}: a nota não está autorizada.`;
}

function readAccessKey(info: XmlNode): string {
  // `Id` vem como "NFe" + 44 dígitos; `chNFe` aparece no protocolo.
  const raw = (info.attributes.Id ?? '').trim();
  const digits = raw.startsWith('NFe') ? raw.slice(3) : raw;
  if (!/^[0-9]{44}$/.test(digits)) {
    throw invalid('chave de acesso ausente ou fora do formato de 44 dígitos');
  }
  if (checkDigit(digits.slice(0, 43)) !== digits[43]) {
    throw invalid('dígito verificador da chave de acesso não confere');
  }
  return digits;
}

/**
 * Dígito verificador da chave de acesso — módulo 11 com pesos 2 a 9, da direita
 * para a esquerda (Manual de Orientação do Contribuinte, anexo III).
 */
function checkDigit(key43: string): string {
  let sum = 0;
  let weight = 2;
  for (let i = key43.length - 1; i >= 0; i--) {
    sum += Number(key43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder <= 1 ? '0' : String(11 - remainder);
}

/**
 * A chave carrega cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) número(9) tpEmis(1)
 * cNF(8) cDV(1). Se o conteúdo do XML diverge dela, um dos dois foi alterado.
 */
function assertKeyMatchesContent(
  key: string,
  content: { modelCode: string; number: string; series: string; issuerTaxId: string },
): void {
  const fromKey = {
    issuerTaxId: key.slice(6, 20),
    modelCode: key.slice(20, 22),
    series: key.slice(22, 25),
    number: key.slice(25, 34),
  };

  const divergences: string[] = [];
  if (fromKey.issuerTaxId !== content.issuerTaxId.padStart(14, '0')) {
    divergences.push('CNPJ do emitente');
  }
  if (fromKey.modelCode !== content.modelCode.padStart(2, '0')) divergences.push('modelo');
  if (fromKey.series !== content.series.padStart(3, '0')) divergences.push('série');
  if (fromKey.number !== content.number.padStart(9, '0')) divergences.push('número');

  if (divergences.length > 0) {
    throw invalid(
      `a chave de acesso não corresponde ao conteúdo da nota (${divergences.join(', ')})`,
    );
  }
}

function readItems(info: XmlNode): ParsedFiscalItem[] {
  const details = children(info, 'det');
  if (details.length === 0) {
    throw invalid('nota sem itens (RF-045)');
  }
  if (details.length > MAX_ITEMS_PER_DOCUMENT) {
    throw invalid(`nota com ${details.length} itens, acima do limite de ${MAX_ITEMS_PER_DOCUMENT}`);
  }

  return details.map((det, position) => {
    const prod = child(det, 'prod');
    const tax = child(det, 'imposto');
    const icms = readIcms(tax);

    const quantity = unitValue(prod, 'qCom');
    const unitPrice = unitValue(prod, 'vUnCom');
    const discountAmount = money(prod, 'vDesc');
    const freightAmount = money(prod, 'vFrete');
    // `vProd` é quantidade × unitário, sem desconto: o total da linha que o
    // modelo guarda já é líquido de desconto e acrescido do frete da linha
    // (bd/12 confere exatamente esta composição).
    const grossAmount = money(prod, 'vProd');

    return {
      sequence: Number(det.attributes.nItem ?? position + 1),
      supplierCode: text(prod, 'cProd'),
      description: required(text(prod, 'xProd'), `det[${position + 1}]/prod/xProd`),
      ncm: digitsOnly(text(prod, 'NCM'), 8),
      cest: digitsOnly(text(prod, 'CEST'), 7),
      cfop: digitsOnly(text(prod, 'CFOP'), 4),
      unit: text(prod, 'uCom')?.slice(0, 6),
      quantity,
      unitPrice,
      discountAmount,
      freightAmount,
      lineAmount: grossAmount.minus(discountAmount).plus(freightAmount),
      icmsCst: icms.cst,
      icmsBase: icms.base,
      icmsRate: icms.rate,
      icmsAmount: icms.amount,
      icmsStAmount: icms.stAmount,
      ipiAmount: money(child(tax, 'IPI', 'IPITrib'), 'vIPI'),
      pisAmount: money(child(tax, 'PIS', 'PISAliq') ?? child(tax, 'PIS', 'PISOutr'), 'vPIS'),
      cofinsAmount: money(
        child(tax, 'COFINS', 'COFINSAliq') ?? child(tax, 'COFINS', 'COFINSOutr'),
        'vCOFINS',
      ),
    };
  });
}

/**
 * O grupo de ICMS varia com a tributação (ICMS00, ICMS60, ICMSSN101, ...) e só
 * um deles vem preenchido. Ler o primeiro que existir evita um `switch` sobre
 * dezessete casos que dizem a mesma coisa.
 */
function readIcms(tax: XmlNode | undefined) {
  const group = child(tax, 'ICMS');
  const filled = group?.children.find((c) => ICMS_GROUPS.includes(c.name));

  return {
    cst: text(filled, 'CST') ?? text(filled, 'CSOSN'),
    base: money(filled, 'vBC'),
    rate: percentage(filled, 'pICMS'),
    amount: money(filled, 'vICMS'),
    stAmount: money(filled, 'vICMSST'),
  };
}

/** Protocolo de autorização, quando o XML é o `nfeProc`. */
function readProtocol(root: XmlNode): Prisma.JsonObject {
  const info = child(root, 'protNFe', 'infProt');
  if (!info) return {};

  return {
    protocolNumber: text(info, 'nProt') ?? null,
    protocolStatus: text(info, 'cStat') ?? null,
    protocolReason: text(info, 'xMotivo') ?? null,
    protocolAt: text(info, 'dhRecbto') ?? null,
  };
}

function money(node: XmlNode | undefined, field: string): Prisma.Decimal {
  return decimal(text(node, field), field, 2);
}

function unitValue(node: XmlNode | undefined, field: string): Prisma.Decimal {
  return decimal(required(text(node, field), field), field, 6);
}

function percentage(node: XmlNode | undefined, field: string): Prisma.Decimal {
  return decimal(text(node, field), field, 6);
}

/**
 * Decimal do XML. O valor chega como string e continua string até o
 * `Prisma.Decimal` — passar por `number` seria trocar centavos por ponto
 * flutuante binário (RN-012).
 */
function decimal(value: string | undefined, field: string, scale: number): Prisma.Decimal {
  if (value === undefined) return ZERO;
  if (!/^-?\d{1,16}(\.\d{1,10})?$/.test(value)) {
    throw invalid(`campo \`${field}\` não é um número decimal (\`${clip(value)}\`)`);
  }
  const parsed = new Prisma.Decimal(value);
  if (parsed.isNegative()) {
    throw invalid(`campo \`${field}\` não pode ser negativo`);
  }
  return parsed.toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
}

function readDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw invalid(`data \`${clip(value)}\` fora do formato ISO-8601`);
  }
  return parsed;
}

function optionalDate(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : readDate(value);
}

/** CNPJ/CPF do XML: só dígitos, no tamanho que a coluna guarda. */
function taxId(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D/g, '');
  if (!digits) return undefined;
  if (digits.length !== 14 && digits.length !== 11) {
    throw invalid(`CNPJ/CPF com ${digits.length} dígitos`);
  }
  return digits;
}

function digitsOnly(value: string | undefined, length: number): string | undefined {
  const digits = value?.replace(/\D/g, '');
  return digits && digits.length === length ? digits : undefined;
}

function required(value: string | undefined, field: string): string {
  if (!value) {
    throw invalid(`campo obrigatório \`${field}\` ausente`);
  }
  return value;
}

/** Trecho curto do valor recusado: a mensagem ajuda sem devolver o arquivo. */
function clip(value: string): string {
  return value.length > 40 ? `${value.slice(0, 40)}…` : value;
}

function invalid(reason: string): BadRequestException {
  return new BadRequestException(`Documento fiscal inválido: ${reason}.`);
}

function unsupported(reason: string): BadRequestException {
  return new BadRequestException(`Documento fiscal não suportado: ${reason}.`);
}
