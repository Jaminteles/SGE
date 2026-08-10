import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingScope } from '../../common/enums';
import { UpsertSettingDto } from './dto/upsert-setting.dto';

/**
 * Parâmetros da empresa (RF-006) — `gestao.parametro_empresa`.
 * A coluna `valor` é jsonb: aceita string, número, booleano ou objeto.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(companyId: string, scope?: SettingScope) {
    const where: Prisma.CompanySettingWhereInput = {
      companyId,
      ...(scope ? { scope } : {}),
    };
    return this.prisma.db.companySetting.findMany({
      where,
      orderBy: [{ scope: 'asc' }, { key: 'asc' }],
    });
  }

  /** Cria ou atualiza um parâmetro pela chave (RF-006). */
  upsert(companyId: string, dto: UpsertSettingDto) {
    return this.prisma.db.companySetting.upsert({
      where: {
        companyId_scope_key: { companyId, scope: dto.scope, key: dto.key },
      },
      create: {
        companyId,
        scope: dto.scope,
        key: dto.key,
        value: dto.value as Prisma.InputJsonValue,
        description: dto.description,
      },
      update: {
        value: dto.value as Prisma.InputJsonValue,
        description: dto.description,
      },
    });
  }

  async remove(companyId: string, id: string) {
    const setting = await this.prisma.db.companySetting.findFirst({ where: { id, companyId } });
    if (!setting) {
      throw new NotFoundException('Parâmetro não encontrado.');
    }
    await this.prisma.db.companySetting.delete({ where: { id } });
  }
}
