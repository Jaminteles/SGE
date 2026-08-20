import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CreateCredentialDto } from './dto/create-credential.dto';
import { UpdateCredentialDto } from './dto/update-credential.dto';

/**
 * Projeção pública da credencial. `secret` não está aqui, e essa ausência é a
 * regra: nenhum caminho da API devolve o segredo (RNF-003/RNF-005).
 */
const PUBLIC_FIELDS = {
  id: true,
  name: true,
  environment: true,
  certificateRef: true,
  expiresAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  provider: { select: { id: true, code: true, name: true, category: true, capabilities: true } },
} as const;

/**
 * Credenciais de integração por empresa (RF-061).
 *
 * O segredo é cifrado antes de tocar o banco e só é decifrado por
 * `ProviderResolver`, no momento de chamar o provedor. Rotacionar é enviar
 * outro `secret` no PATCH; o anterior não é recuperável nem por quem administra
 * a empresa — que é o ponto.
 */
@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Catálogo global de provedores (RF-061) — somente leitura. */
  async listProviders() {
    return this.prisma.db.provider.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
        description: true,
        capabilities: true,
      },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.db.integrationCredential.findMany({
      where: { companyId },
      orderBy: [{ createdAt: 'desc' }],
      select: PUBLIC_FIELDS,
    });
  }

  async findOne(companyId: string, id: string) {
    const credential = await this.prisma.db.integrationCredential.findFirst({
      where: { id, companyId },
      select: PUBLIC_FIELDS,
    });
    if (!credential) {
      throw new NotFoundException('Credencial de integração não encontrada.');
    }
    return credential;
  }

  async create(companyId: string, dto: CreateCredentialDto) {
    const provider = await this.prisma.db.provider.findFirst({
      where: { id: dto.providerId, isActive: true },
      select: { id: true },
    });
    if (!provider) {
      throw new BadRequestException('Provedor inválido ou inativo.');
    }

    return this.prisma.db.integrationCredential.create({
      data: {
        companyId,
        providerId: dto.providerId,
        name: dto.name,
        environment: dto.environment ?? 'PRODUCAO',
        secret: this.crypto.encrypt(JSON.stringify(dto.secret)),
        certificateRef: dto.certificateRef,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        isActive: dto.isActive ?? true,
      },
      select: PUBLIC_FIELDS,
    });
  }

  async update(companyId: string, id: string, dto: UpdateCredentialDto) {
    await this.findOne(companyId, id);

    return this.prisma.db.integrationCredential.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.secret !== undefined
          ? { secret: this.crypto.encrypt(JSON.stringify(dto.secret)) }
          : {}),
        ...(dto.certificateRef !== undefined ? { certificateRef: dto.certificateRef } : {}),
        ...(dto.expiresAt !== undefined ? { expiresAt: new Date(dto.expiresAt) } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      select: PUBLIC_FIELDS,
    });
  }

  /**
   * Desativa a credencial. Não apaga: contas bancárias e transações já enviadas
   * apontam para ela, e o histórico precisa dizer com qual credencial a ordem
   * saiu.
   */
  async deactivate(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.db.integrationCredential.update({
      where: { id },
      data: { isActive: false },
      select: PUBLIC_FIELDS,
    });
  }
}
