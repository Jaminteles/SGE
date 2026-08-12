import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PartnersService } from './partners.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

/** Contatos do parceiro (RF-024) — `gestao.contato`. */
@Injectable()
export class PartnerContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partners: PartnersService,
  ) {}

  async create(companyId: string, partnerId: string, dto: CreateContactDto) {
    await this.partners.findOne(companyId, partnerId);

    return this.prisma.transaction(async () => {
      if (dto.isPrimary) {
        await this.clearPrimary(companyId, partnerId);
      }
      return this.prisma.db.contact.create({
        data: {
          companyId,
          partnerId,
          name: dto.name,
          role: dto.role,
          email: dto.email,
          phone: dto.phone,
          mobile: dto.mobile,
          note: dto.note,
          isPrimary: dto.isPrimary ?? false,
        },
      });
    });
  }

  async findAll(companyId: string, partnerId: string) {
    await this.partners.findOne(companyId, partnerId);
    return this.prisma.db.contact.findMany({
      where: { companyId, partnerId },
      orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    });
  }

  async update(companyId: string, partnerId: string, id: string, dto: UpdateContactDto) {
    const current = await this.load(companyId, partnerId, id);

    return this.prisma.transaction(async () => {
      if (dto.isPrimary) {
        await this.clearPrimary(companyId, partnerId);
      }
      return this.prisma.db.contact.update({
        where: { id: current.id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.mobile !== undefined ? { mobile: dto.mobile } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
        },
      });
    });
  }

  /** Contato não tem coluna `ativo` no banco: a remoção é definitiva. */
  async remove(companyId: string, partnerId: string, id: string) {
    const current = await this.load(companyId, partnerId, id);
    await this.prisma.db.contact.delete({ where: { id: current.id } });
  }

  private async load(companyId: string, partnerId: string, id: string) {
    const contact = await this.prisma.db.contact.findFirst({
      where: { id, companyId, partnerId },
    });
    if (!contact) {
      throw new NotFoundException('Contato não encontrado.');
    }
    return contact;
  }

  /** Só existe um contato principal por parceiro. */
  private async clearPrimary(companyId: string, partnerId: string) {
    await this.prisma.db.contact.updateMany({
      where: { companyId, partnerId, isPrimary: true },
      data: { isPrimary: false },
    });
  }
}
