import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PartnersService } from './partners.service';
import { CreatePartnerAddressDto } from './dto/create-partner-address.dto';
import { UpdatePartnerAddressDto } from './dto/update-partner-address.dto';

/**
 * Endereços do parceiro (RF-024) — `gestao.endereco`.
 *
 * A tabela é compartilhada com empresa e filial e tem CHECK de dono único; as
 * consultas daqui sempre filtram por `partnerId`, então nenhum endereço de
 * outro dono entra nas respostas.
 */
@Injectable()
export class PartnerAddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partners: PartnersService,
  ) {}

  async create(companyId: string, partnerId: string, dto: CreatePartnerAddressDto) {
    await this.partners.findOne(companyId, partnerId);

    return this.prisma.transaction(async () => {
      if (dto.isPrimary) {
        await this.clearPrimary(companyId, partnerId);
      }
      return this.prisma.db.address.create({
        data: {
          companyId,
          partnerId,
          type: dto.type ?? 'PRINCIPAL',
          street: dto.street,
          number: dto.number,
          complement: dto.complement,
          district: dto.district,
          city: dto.city,
          state: dto.state,
          zipCode: dto.zipCode,
          ...(dto.country !== undefined ? { country: dto.country } : {}),
          ibgeCode: dto.ibgeCode,
          isPrimary: dto.isPrimary ?? false,
        },
      });
    });
  }

  async findAll(companyId: string, partnerId: string) {
    await this.partners.findOne(companyId, partnerId);
    return this.prisma.db.address.findMany({
      where: { companyId, partnerId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async update(companyId: string, partnerId: string, id: string, dto: UpdatePartnerAddressDto) {
    const current = await this.load(companyId, partnerId, id);

    return this.prisma.transaction(async () => {
      if (dto.isPrimary) {
        await this.clearPrimary(companyId, partnerId);
      }
      return this.prisma.db.address.update({
        where: { id: current.id },
        data: {
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.street !== undefined ? { street: dto.street } : {}),
          ...(dto.number !== undefined ? { number: dto.number } : {}),
          ...(dto.complement !== undefined ? { complement: dto.complement } : {}),
          ...(dto.district !== undefined ? { district: dto.district } : {}),
          ...(dto.city !== undefined ? { city: dto.city } : {}),
          ...(dto.state !== undefined ? { state: dto.state } : {}),
          ...(dto.zipCode !== undefined ? { zipCode: dto.zipCode } : {}),
          ...(dto.country !== undefined ? { country: dto.country } : {}),
          ...(dto.ibgeCode !== undefined ? { ibgeCode: dto.ibgeCode } : {}),
          ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
        },
      });
    });
  }

  /** Endereço não tem coluna `ativo` no banco: a remoção é definitiva. */
  async remove(companyId: string, partnerId: string, id: string) {
    const current = await this.load(companyId, partnerId, id);
    await this.prisma.db.address.delete({ where: { id: current.id } });
  }

  private async load(companyId: string, partnerId: string, id: string) {
    const address = await this.prisma.db.address.findFirst({
      where: { id, companyId, partnerId },
    });
    if (!address) {
      throw new NotFoundException('Endereço não encontrado.');
    }
    return address;
  }

  /** Só existe um endereço principal por parceiro. */
  private async clearPrimary(companyId: string, partnerId: string) {
    await this.prisma.db.address.updateMany({
      where: { companyId, partnerId, isPrimary: true },
      data: { isPrimary: false },
    });
  }
}
