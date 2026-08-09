import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SettingScope } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertSettingDto } from './dto/upsert-setting.dto';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista parâmetros financeiros/fiscais, opcionalmente por escopo (RF-006). */
  findAll(companyId: string, scope?: SettingScope) {
    const where: Prisma.CompanySettingWhereInput = {
      companyId,
      ...(scope ? { scope } : {}),
    };
    return this.prisma.companySetting.findMany({
      where,
      orderBy: [{ scope: 'asc' }, { key: 'asc' }],
    });
  }

  /** Cria ou atualiza um parâmetro pela chave (RF-006). */
  upsert(companyId: string, dto: UpsertSettingDto) {
    return this.prisma.companySetting.upsert({
      where: {
        companyId_scope_key: { companyId, scope: dto.scope, key: dto.key },
      },
      create: {
        companyId,
        scope: dto.scope,
        key: dto.key,
        value: dto.value,
        description: dto.description,
      },
      update: {
        value: dto.value,
        description: dto.description,
      },
    });
  }

  async remove(companyId: string, id: string) {
    const setting = await this.prisma.companySetting.findFirst({ where: { id, companyId } });
    if (!setting) {
      throw new NotFoundException('Parâmetro não encontrado.');
    }
    await this.prisma.companySetting.delete({ where: { id } });
  }
}
