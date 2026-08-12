import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreatePaymentTermDto } from './dto/create-payment-term.dto';
import { UpdatePaymentTermDto } from './dto/update-payment-term.dto';

/** Condições de pagamento (RF-026) — `gestao.condicao_pagamento`. */
@Injectable()
export class PaymentTermsService {
  constructor(private readonly prisma: PrismaService) {}

  create(companyId: string, dto: CreatePaymentTermDto) {
    return this.prisma.db.paymentTerm.create({
      data: {
        companyId,
        code: dto.code,
        name: dto.name,
        ...(dto.installments !== undefined ? { installments: dto.installments } : {}),
        ...(dto.intervalDays !== undefined ? { intervalDays: dto.intervalDays } : {}),
        ...(dto.firstDueDays !== undefined ? { firstDueDays: dto.firstDueDays } : {}),
        ...(dto.discountPercent !== undefined
          ? { discountPercent: new Prisma.Decimal(dto.discountPercent) }
          : {}),
      },
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.PaymentTermWhereInput = {
      companyId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const data = await this.prisma.db.paymentTerm.findMany({
      where,
      orderBy: { code: 'asc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.paymentTerm.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const term = await this.prisma.db.paymentTerm.findFirst({ where: { id, companyId } });
    if (!term) {
      throw new NotFoundException('Condição de pagamento não encontrada.');
    }
    return term;
  }

  async update(companyId: string, id: string, dto: UpdatePaymentTermDto) {
    await this.findOne(companyId, id);
    return this.prisma.db.paymentTerm.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.installments !== undefined ? { installments: dto.installments } : {}),
        ...(dto.intervalDays !== undefined ? { intervalDays: dto.intervalDays } : {}),
        ...(dto.firstDueDays !== undefined ? { firstDueDays: dto.firstDueDays } : {}),
        ...(dto.discountPercent !== undefined
          ? { discountPercent: new Prisma.Decimal(dto.discountPercent) }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  /** Inativa: condição já usada em título ou pedido não é removida (RN-009). */
  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.db.paymentTerm.update({ where: { id }, data: { isActive: false } });
  }
}
