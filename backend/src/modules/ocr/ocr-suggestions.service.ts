import { Injectable } from '@nestjs/common';
import { EntryType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExtractedFields } from './ocr-extraction.service';

/** O que o módulo propõe a quem for lançar a despesa (RF-098). */
export interface OcrSuggestions {
  partnerId?: string;
  categoryId?: string;
  costCenterId?: string;
  /** Por que foi sugerido — a interface mostra isso ao lado da sugestão. */
  reasons: string[];
}

/** Quantos títulos do parceiro entram na votação da categoria. */
const HISTORY_SIZE = 20;

/**
 * Sugestão de parceiro, categoria e centro de custo (RF-098).
 *
 * Sugestão por **histórico**, não por adivinhação: o CNPJ lido identifica o
 * parceiro, e a categoria proposta é a que aquele parceiro recebeu com mais
 * frequência nos últimos títulos. É a regra que o usuário consegue explicar
 * para si mesmo — "sempre lanço posto de gasolina em Combustível" — e a única
 * que erra de um jeito previsível quando erra.
 *
 * Sem CNPJ legível ou sem parceiro cadastrado, não há sugestão. Deixar os
 * campos nulos é melhor que propor a categoria mais usada da empresa: uma
 * sugestão sem fundamento é aceita no automático por quem revisa em lote, e aí
 * o erro entra no financeiro com a aparência de ter sido conferido.
 *
 * Nada aqui escreve: quem grava é `OcrProcessingService`, na transação do job.
 */
@Injectable()
export class OcrSuggestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async suggest(companyId: string, fields: ExtractedFields): Promise<OcrSuggestions> {
    const reasons: string[] = [];

    const partner = await this.findPartner(companyId, fields.merchantDocument);
    if (!partner) {
      return { reasons };
    }
    reasons.push(`Parceiro ${partner.legalName} identificado pelo documento do emitente.`);

    const history = await this.prisma.db.financialEntry.findMany({
      where: {
        companyId,
        partnerId: partner.id,
        type: EntryType.PAGAR,
        canceledAt: null,
      },
      orderBy: { issueDate: 'desc' },
      take: HISTORY_SIZE,
      select: { categoryId: true, costCenterId: true },
    });

    const categoryId = mostFrequent(history.map((entry) => entry.categoryId));
    const costCenterId = mostFrequent(history.map((entry) => entry.costCenterId));

    if (categoryId) {
      reasons.push('Categoria mais usada nos últimos títulos deste parceiro.');
    }
    if (costCenterId) {
      reasons.push('Centro de custo mais usado nos últimos títulos deste parceiro.');
    }

    // A categoria e o centro de custo vêm de títulos da mesma empresa, lidos sob
    // a RLS: não há como o histórico de outra empresa entrar na sugestão.
    return { partnerId: partner.id, categoryId, costCenterId, reasons };
  }

  private async findPartner(companyId: string, document: string | undefined) {
    if (!document) {
      return null;
    }
    return this.prisma.db.partner.findFirst({
      where: {
        companyId,
        isActive: true,
        ...(document.length === 14 ? { cnpj: document } : { cpf: document }),
      },
      select: { id: true, legalName: true },
    });
  }
}

/**
 * Valor que mais aparece, ignorando nulos. Empate fica com o mais recente:
 * a lista chega ordenada por data decrescente, e mudança de categoria costuma
 * ser decisão nova, não engano.
 */
function mostFrequent(values: (string | null)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}
