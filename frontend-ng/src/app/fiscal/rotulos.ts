import type {
  FiscalDocument,
  FiscalDocumentModel,
  FiscalDocumentOrigin,
  FiscalDocumentStatus,
  FiscalDocumentSummary,
  FiscalImportOutcome,
} from '../core/api/types';
import type { Consulta } from '../core/lib/list-state';
import type { DefinicaoFiltro, OpcaoFiltro, ValoresFiltro } from '../ui/filter-bar';

/** Severidades aceitas pela `p-tag` do PrimeNG. */
export type Severidade = 'success' | 'warn' | 'danger' | 'info' | 'secondary';

function opcoes<T extends string>(rotulos: Record<T, string>): OpcaoFiltro[] {
  return (Object.keys(rotulos) as T[]).map((valor) => ({ value: valor, label: rotulos[valor] }));
}

// ---------------------------------------------------------------------------
// Situação, modelo e origem (RF-043/RF-049/RF-050)
// ---------------------------------------------------------------------------

export const ROTULO_STATUS_NOTA: Record<FiscalDocumentStatus, string> = {
  RECEBIDO: 'Recebido',
  PROCESSANDO: 'Processando',
  PROCESSADO: 'Processado',
  ERRO: 'Com erro',
  DUPLICADO: 'Duplicado',
  CANCELADO: 'Descartado',
  DENEGADO: 'Denegado',
};

const SEVERIDADE_STATUS_NOTA: Record<FiscalDocumentStatus, Severidade> = {
  RECEBIDO: 'info',
  PROCESSANDO: 'info',
  PROCESSADO: 'success',
  ERRO: 'danger',
  DUPLICADO: 'warn',
  CANCELADO: 'secondary',
  DENEGADO: 'danger',
};

export function severidadeNota(status: FiscalDocumentStatus): Severidade {
  return SEVERIDADE_STATUS_NOTA[status] ?? 'secondary';
}

export const ROTULO_MODELO: Record<FiscalDocumentModel, string> = {
  NFE: 'NF-e',
  NFCE: 'NFC-e',
  NFSE: 'NFS-e',
  CTE: 'CT-e',
  CTE_OS: 'CT-e OS',
  MDFE: 'MDF-e',
  NFAVULSA: 'NF avulsa',
  RECIBO: 'Recibo',
  OUTRO: 'Outro',
};

export const ROTULO_ORIGEM: Record<FiscalDocumentOrigin, string> = {
  UPLOAD_MANUAL: 'Upload manual',
  COLETA_AUTOMATICA: 'Coleta automática',
  API: 'API',
  EMAIL: 'E-mail',
  WEBHOOK: 'Webhook',
};

/** Resultado de uma importação, na linguagem de quem acompanha a fila (UI-036). */
export const ROTULO_RESULTADO: Record<FiscalImportOutcome, string> = {
  IMPORTADO: 'Importado',
  JA_IMPORTADO: 'Já importado',
  DUPLICADO: 'Duplicado',
  ERRO: 'Importado com erro',
};

const SEVERIDADE_RESULTADO: Record<FiscalImportOutcome, Severidade> = {
  IMPORTADO: 'success',
  JA_IMPORTADO: 'info',
  DUPLICADO: 'warn',
  ERRO: 'danger',
};

export function severidadeResultado(resultado: FiscalImportOutcome): Severidade {
  return SEVERIDADE_RESULTADO[resultado] ?? 'secondary';
}

export const FILTRO_STATUS_NOTA: DefinicaoFiltro = {
  name: 'status',
  label: 'Situação',
  placeholder: 'Situação',
  options: opcoes(ROTULO_STATUS_NOTA),
};

export const FILTRO_ORIGEM: DefinicaoFiltro = {
  name: 'origin',
  label: 'Origem',
  placeholder: 'Origem',
  options: opcoes(ROTULO_ORIGEM),
};

export const FILTRO_PENDENCIA: DefinicaoFiltro = {
  name: 'pendingOnly',
  label: 'Pendência',
  placeholder: 'Pendência',
  options: [{ value: 'true', label: 'Somente o que exige ação' }],
};

/**
 * Traduz a barra para `QueryFiscalDocumentDto` (período = emissão). A API usa
 * `to` exclusivo, então o último dia escolhido vira o dia seguinte.
 */
export function consultaNota(filtros: ValoresFiltro): Consulta {
  return {
    q: filtros.q,
    status: filtros['status'] || undefined,
    origin: filtros['origin'] || undefined,
    pendingOnly: filtros['pendingOnly'] === 'true' ? true : undefined,
    from: filtros['from'] || undefined,
    to: filtros['to'] ? diaSeguinte(filtros['to']) : undefined,
  };
}

export function diaSeguinte(data: string): string {
  const [ano, mes, dia] = data.split('-').map((parte) => Number.parseInt(parte, 10));
  return new Date(Date.UTC(ano, mes - 1, dia + 1)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Regras de tela — espelham as do backend, que decide de novo a cada chamada
// ---------------------------------------------------------------------------

/** `REPROCESSABLE` do backend: só o que ainda não fechou relê o XML (RF-049). */
export function reprocessavel(nota: Pick<FiscalDocument, 'status'>): boolean {
  return nota.status === 'RECEBIDO' || nota.status === 'ERRO';
}

/** `LINKABLE` do backend: vínculo e anexo enquanto o documento está vivo (RF-047/RF-048). */
export function vinculavel(nota: Pick<FiscalDocument, 'status'>): boolean {
  return ['RECEBIDO', 'PROCESSANDO', 'PROCESSADO', 'ERRO'].includes(nota.status);
}

/**
 * Descarte (RF-049): situação que ainda transita para CANCELADO (bd/12) e
 * nenhum efeito gerado — estoque e título se desfazem no módulo de origem.
 */
export function descartavel(
  nota: Pick<FiscalDocument, 'status' | 'generatedStock' | 'generatedPayable'>,
): boolean {
  return (
    ['RECEBIDO', 'ERRO', 'PROCESSADO', 'DUPLICADO'].includes(nota.status) &&
    !nota.generatedStock &&
    !nota.generatedPayable
  );
}

/**
 * Quais efeitos a nota ainda pode gerar (RF-047). Nota com recebimento já tem
 * quem dê a entrada — a conferência do pedido (RN-004).
 */
export function efeitosPendentes(nota: FiscalDocument): { estoque: boolean; titulo: boolean } {
  const pode = nota.status === 'PROCESSADO' && nota.receipts.length === 0;
  return { estoque: pode && !nota.generatedStock, titulo: pode && !nota.generatedPayable };
}

export function numeroNota(nota: Pick<FiscalDocumentSummary, 'number' | 'series'>): string {
  return nota.series ? `${nota.number}/${nota.series}` : nota.number;
}

export function emitente(nota: Pick<FiscalDocumentSummary, 'issuerPartner' | 'issuerName'>) {
  return nota.issuerPartner?.tradeName ?? nota.issuerPartner?.legalName ?? nota.issuerName ?? '—';
}

/** Chave de acesso em blocos de 4 dígitos, como no DANFE. */
export function formatarChave(chave: string | null): string {
  if (!chave) return '—';
  return chave.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** CNPJ/CPF para leitura. Outro tamanho volta como veio. */
export function formatarDocumento(valor: string | null): string {
  if (!valor) return '—';
  if (valor.length === 14) {
    return valor.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  if (valor.length === 11) return valor.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return valor;
}

/** Tamanho de arquivo para leitura humana. */
export function tamanhoArquivo(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/**
 * Salva um `Blob` recebido da API. A URL de objeto é revogada logo após o
 * clique: mantê-la viva deixaria o arquivo acessível pelo endereço.
 */
export function salvarArquivo(conteudo: Blob, nome: string): void {
  const url = URL.createObjectURL(conteudo);
  const ancora = document.createElement('a');
  ancora.href = url;
  ancora.download = nome;
  ancora.click();
  URL.revokeObjectURL(url);
}
