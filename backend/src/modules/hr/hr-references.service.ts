import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Referências que o M03 faz a cadastros de outros módulos ou dele mesmo. */
export type ReferenceKind =
  | 'branchId'
  | 'costCenterId'
  | 'categoryId'
  | 'positionId'
  | 'departmentId'
  | 'employeeId'
  | 'managerId'
  | 'payrollItemId';

type Reference = Partial<Record<ReferenceKind, string | null | undefined>>;

/**
 * Confere que toda referência informada existe **dentro da empresa ativa**.
 *
 * O banco já impede o vínculo entre empresas por FK composta (bd/06); esta
 * camada existe para transformar o que seria um 500 de violação de chave numa
 * mensagem clara, e para responder 400 em vez de revelar, por diferença de erro,
 * que o id existe em outra empresa (RF-005).
 *
 * Fica num serviço só porque as mesmas cinco perguntas aparecem em funcionário,
 * evento, verba e reembolso — repetir `ensureX` em cada service era o caminho
 * curto para uma delas ficar sem o filtro de empresa.
 */
@Injectable()
export class HrReferencesService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly lookups: Record<
    ReferenceKind,
    { label: string; find: (companyId: string, id: string) => Promise<{ id: string } | null> }
  > = {
    branchId: {
      label: 'Filial',
      find: (companyId, id) =>
        this.prisma.db.branch.findFirst({ where: { id, companyId }, select: { id: true } }),
    },
    costCenterId: {
      label: 'Centro de custo',
      find: (companyId, id) =>
        this.prisma.db.costCenter.findFirst({ where: { id, companyId }, select: { id: true } }),
    },
    categoryId: {
      label: 'Categoria financeira',
      find: (companyId, id) =>
        this.prisma.db.category.findFirst({ where: { id, companyId }, select: { id: true } }),
    },
    positionId: {
      label: 'Cargo',
      find: (companyId, id) =>
        this.prisma.db.position.findFirst({ where: { id, companyId }, select: { id: true } }),
    },
    departmentId: {
      label: 'Departamento',
      find: (companyId, id) =>
        this.prisma.db.department.findFirst({ where: { id, companyId }, select: { id: true } }),
    },
    employeeId: {
      label: 'Funcionário',
      find: (companyId, id) =>
        this.prisma.db.employee.findFirst({ where: { id, companyId }, select: { id: true } }),
    },
    managerId: {
      label: 'Gestor',
      find: (companyId, id) =>
        this.prisma.db.employee.findFirst({ where: { id, companyId }, select: { id: true } }),
    },
    payrollItemId: {
      label: 'Verba',
      find: (companyId, id) =>
        this.prisma.db.payrollItem.findFirst({ where: { id, companyId }, select: { id: true } }),
    },
  };

  /**
   * Valida as referências informadas (`undefined` e `null` são ignorados: são
   * "não mexer" e "desvincular", respectivamente).
   *
   * Sequencial de propósito: a transação da requisição roda numa única conexão.
   */
  async assert(companyId: string, references: Reference): Promise<void> {
    for (const [kind, id] of Object.entries(references) as [ReferenceKind, string | null][]) {
      if (!id) continue;
      const lookup = this.lookups[kind];
      const found = await lookup.find(companyId, id);
      if (!found) {
        throw new BadRequestException(`${lookup.label} inválido para esta empresa.`);
      }
    }
  }

  /**
   * O usuário vinculado ao funcionário precisa ter acesso à mesma empresa
   * (RF-004): sem isso, um id de usuário de outro tenant entraria no cadastro e
   * passaria a valer como identidade do solicitante nos reembolsos.
   */
  async assertUserBelongsToCompany(companyId: string, userId: string | null | undefined) {
    if (!userId) return;
    const membership = await this.prisma.db.membership.findFirst({
      where: { userId, companyId },
      select: { id: true },
    });
    if (!membership) {
      throw new BadRequestException('Usuário informado não está associado a esta empresa.');
    }
  }
}
