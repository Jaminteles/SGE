/** Marca de ordem de bytes: sem ela o Excel abre o CSV em ANSI e come os acentos. */
const BOM = '﻿';

export interface ColunaExportavel {
  campo: string;
  cabecalho: string;
}

/**
 * CSV das listagens (RF-113 — UI-080).
 *
 * Mesmas escolhas do exportador do backend (`common/export/csv.renderer.ts`):
 * `;` como separador, porque a planilha em português espera isso; todo campo
 * entre aspas; e `CRLF` no fim da linha. Um arquivo exportado da tela e um
 * exportado do relatório abrem iguais.
 *
 * `campo` aceita caminho com ponto (`partner.legalName`) — é como as listagens
 * já nomeiam as colunas que vêm de um objeto aninhado.
 */
export function paraCsv(linhas: readonly unknown[], colunas: readonly ColunaExportavel[]): string {
  const cabecalho = colunas.map((coluna) => escapar(coluna.cabecalho)).join(';');
  const corpo = linhas.map((linha) =>
    colunas.map((coluna) => escapar(texto(valorDoCampo(linha, coluna.campo)))).join(';'),
  );
  return BOM + [cabecalho, ...corpo].join('\r\n');
}

/** Valor de `linha` no caminho `campo`, aceitando pontos. */
export function valorDoCampo(linha: unknown, campo: string): unknown {
  return campo.split('.').reduce<unknown>((atual, parte) => {
    if (atual === null || atual === undefined || typeof atual !== 'object') return undefined;
    return (atual as Record<string, unknown>)[parte];
  }, linha);
}

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (typeof valor === 'object') return '';
  return String(valor);
}

function escapar(valor: string): string {
  return `"${valor.replace(/"/g, '""')}"`;
}

/**
 * Entrega o arquivo ao navegador.
 *
 * O `URL.revokeObjectURL` não pode vir na mesma volta do laço de eventos: em
 * alguns navegadores o download ainda não começou e o arquivo sai vazio.
 */
export function baixarArquivo(nomeArquivo: string, conteudo: string, tipo: string): void {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `parceiros-2027-09-20.csv` — data no nome para não sobrescrever a exportação de ontem. */
export function nomeComData(prefixo: string, extensao: string): string {
  const hoje = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const data = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`;
  return `${prefixo}-${data}.${extensao}`;
}
