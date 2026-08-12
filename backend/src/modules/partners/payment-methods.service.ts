import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';

/** Formas de pagamento (RF-026) — `gestao.forma_pagamento`. */
@Injectable()
export class PaymentMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  create(companyId: string, dto: CreatePaymentMethodDto) {
    return this.prisma.db.paymentMethod.create({
      data: { companyId, code: dto.code, name: dto.name, method: dto.method },
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.PaymentMethodWhereInput = {
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

    const data = await this.prisma.db.paymentMethod.findMany({
      where,
      orderBy: { code: 'asc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.paymentMethod.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const method = await this.prisma.db.paymentMethod.findFirst({ where: { id, companyId } });
    if (!method) {
      throw new NotFoundException('Forma de pagamento não encontrada.');
    }
    return method;
  }

  async update(companyId: string, id: string, dto: UpdatePaymentMethodDto) {
    await this.findOne(companyId, id);
    return this.prisma.db.paymentMethod.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.method !== undefined ? { method: dto.method } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  /** Inativa: forma já usada em título ou pedido não é removida (RN-009). */
  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.db.paymentMethod.update({ where: { id }, data: { isActive: false } });
  }
}
