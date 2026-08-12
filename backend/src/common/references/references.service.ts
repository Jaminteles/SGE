import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Cadastros que um módulo pode referenciar dentro da própria empresa. */
export type ReferenceKind =
  | 'branchId'
  | 'costCenterId'
  | 'categoryId'
  | 'positionId'
  | 'departmentId'
  | 'employeeId'
  | 'managerId'
  | 'payrollItemId'
  | 'partnerId'
  | 'customerId'
  | 'supplierId'
  | 'paymentMethodId'
  | 'paymentTermId'
  | 'productId'
  | 'productCategoryId'
  | 'unitId';

type Reference = Partial<Record<ReferenceKind, string | null | undefined>>;

/**
 * Confere que toda referência informada existe **dentro da empresa ativa**.
 *
 * O banco já impede o vínculo entre empresas por FK composta (bd/06 e bd/07);
 * esta camada existe para transformar o que seria um 500 de violação de chave
 * numa mensagem clara, e para responder 400 em vez de revelar, por diferença de
 * erro, que o id existe em outra empresa (RF-005).
 *
 * Fica num serviço só porque as mesmas perguntas aparecem em funcionário,
 * reembolso, parceiro e produto — repetir `ensureX` em cada service era o
 * caminho curto para uma delas ficar sem o filtro de empresa.
 */
@Injectable()
export class ReferencesService {
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
    partnerId: {
      label: 'Parceiro',
      find: (companyId, id) =>
        this.prisma.db.partner.findFirst({ where: { id, companyId }, select: { id: true } }),
    },
    // Papel, e não só existência: um título a receber emitido contra quem nunca
    // foi cliente é erro de cadastro, não de digitação (RF-022/RF-023).
    customerId: {
      label: 'Cliente',
      find: (companyId, id) =>
        this.prisma.db.partner.findFirst({
          where: { id, companyId, isCustomer: true },
          select: { id: true },
        }),
    },
    supplierId: {
      label: 'Fornecedor',
      find: (companyId, id) =>
        this.prisma.db.partner.findFirst({
          where: { id, companyId, isSupplier: true },
          select: { id: true },
        }),
    },
    paymentMethodId: {
      label: 'Forma de pagamento',
      find: (companyId, id) =>
        this.prisma.db.paymentMethod.findFirst({ where: { id, companyId }, select: { id: true } }),
    },
    paymentTermId: {
      label: 'Condição de pagamento',
      find: (companyId, id) =>
        this.prisma.db.paymentTerm.findFirst({ where: { id, companyId }, select: { id: true } }),
    },
    productId: {
      label: 'Produto',
      find: (companyId, id) =>
        this.prisma.db.product.findFirst({ where: { id, companyId }, select: { id: true } }),
    },
    productCategoryId: {
      label: 'Categoria de produto',
      find: (companyId, id) =>
        this.prisma.db.productCategory.findFirst({
          where: { id, companyId },
          select: { id: true },
        }),
    },
    unitId: {
      label: 'Unidade de medida',
      find: (companyId, id) =>
        this.prisma.db.unitOfMeasure.findFirst({ where: { id, companyId }, select: { id: true } }),
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
