import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import {
  INTEGRATION_EVENT_TYPE,
  IntegrationEventsService,
} from '../../common/integrations/integration-events.service';
import {
  CreateIntegrationDto,
  QueryIntegrationDto,
  SetIntegrationParametersDto,
  SuspendIntegrationDto,
  UpdateIntegrationDto,
} from './dto/integration.dto';

/**
 * Projeção pública da integração.
 *
 * A credencial aparece pelo id e pelo nome — nunca pelo segredo, que não tem
 * caminho de saída em lugar nenhum da API (RNF-003/RNF-005). Listar o campo por
 * omissão, e não por `omit`, é o que garante que uma coluna sensível
 * acrescentada depois não vaze sozinha.
 */
const PUBLIC_FIELDS = {
  id: true,
  code: true,
  name: true,
  environment: true,
  parameters: true,
  status: true,
  isActive: true,
  timeoutMs: true,
  maxAttempts: true,
  failureStreak: true,
  failureThreshold: true,
  lastRunAt: true,
  lastSuccessAt: true,
  lastFailureAt: true,
  lastError: true,
  suspensionReason: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  provider: { select: { id: true, code: true, name: true, category: true, capabilities: true } },
  credential: { select: { id: true, name: true, environment: true, expiresAt: true } },
} as const;

/**
 * Chave de parâmetro com nome de credencial (RF-127).
 *
 * Repete a checagem do trigger de bd/20 de propósito: aqui a recusa vira 400
 * com mensagem útil; lá ela é a garantia de que nenhum caminho — seed, script,
 * outro serviço — contorna a regra.
 */
const SECRET_LIKE_KEY =
  /(senha|password|secret|segredo|token|api[_-]?key|chave[_-]?api|private[_-]?key|credential|credencial|authorization|passphrase)/i;

/**
 * Administração das integrações externas da empresa (RF-126/RF-127).
 *
 * Toda leitura e toda escrita passam por `companyId` além da RLS. Não é
 * redundância inútil: a RLS protege a sessão de banco, e o `where` explícito
 * protege contra o caminho em que a empresa ativa da sessão é a certa mas o id
 * da rota é de outra — que é como o IDOR aparece num sistema com RLS ligada.
 * O 404 (e não 403) para recurso de outra empresa é deliberado: confirmar que o
 * id existe já é informação.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: IntegrationEventsService,
  ) {}

  async findAll(companyId: string, query: QueryIntegrationDto) {
    const where: Prisma.IntegrationWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.providerId ? { providerId: query.providerId } : {}),
      ...(query.environment ? { environment: query.environment } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' as const } },
              { name: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.db.integration.findMany({
        where,
        orderBy: [{ code: 'asc' }],
        skip: query.skip,
        take: query.take,
        select: PUBLIC_FIELDS,
      }),
      this.prisma.db.integration.count({ where }),
    ]);

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const integration = await this.prisma.db.integration.findFirst({
      where: { id, companyId },
      select: PUBLIC_FIELDS,
    });
    if (!integration) {
      throw new NotFoundException('Integração não encontrada.');
    }
    return integration;
  }

  async create(companyId: string, dto: CreateIntegrationDto) {
    this.assertParametersAreNotSecrets(dto.parameters);

    const provider = await this.prisma.db.provider.findFirst({
      where: { id: dto.providerId, isActive: true },
      select: { id: true },
    });
    if (!provider) {
      throw new BadRequestException('Provedor inválido ou inativo.');
    }

    if (dto.credentialId) {
      await this.assertCredentialBelongs(companyId, dto.providerId, dto.credentialId);
    }

    const duplicate = await this.prisma.db.integration.findFirst({
      where: { companyId, code: dto.code },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(`Já existe uma integração com o código ${dto.code}.`);
    }

    const created = await this.prisma.db.integration.create({
      data: {
        companyId,
        providerId: dto.providerId,
        credentialId: dto.credentialId,
        code: dto.code,
        name: dto.name,
        environment: dto.environment ?? 'PRODUCAO',
        parameters: (dto.parameters ?? {}) as Prisma.InputJsonValue,
        timeoutMs: dto.timeoutMs,
        maxAttempts: dto.maxAttempts,
        failureThreshold: dto.failureThreshold,
        note: dto.note,
        // Nasce INATIVA: uma integração que já sobe chamando o provedor com
        // parâmetros recém-digitados é um erro de digitação virando ordem real.
        status: IntegrationStatus.INATIVA,
      },
      select: PUBLIC_FIELDS,
    });

    await this.events.record({
      companyId,
      integrationId: created.id,
      providerId: dto.providerId,
      type: INTEGRATION_EVENT_TYPE.CONFIGURATION,
      operation: 'integracao.criar',
      message: `Integração ${created.code} cadastrada.`,
      detail: { environment: created.environment, parametros: dto.parameters ?? {} },
    });

    return created;
  }

  async update(companyId: string, id: string, dto: UpdateIntegrationDto) {
    const current = await this.findOne(companyId, id);
    this.assertParametersAreNotSecrets(dto.parameters);

    if (dto.credentialId) {
      await this.assertCredentialBelongs(companyId, current.provider.id, dto.credentialId);
    }

    const updated = await this.prisma.db.integration.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.credentialId !== undefined ? { credentialId: dto.credentialId } : {}),
        ...(dto.environment !== undefined ? { environment: dto.environment } : {}),
        ...(dto.parameters !== undefined
          ? { parameters: dto.parameters as Prisma.InputJsonValue }
          : {}),
        ...(dto.timeoutMs !== undefined ? { timeoutMs: dto.timeoutMs } : {}),
        ...(dto.maxAttempts !== undefined ? { maxAttempts: dto.maxAttempts } : {}),
        ...(dto.failureThreshold !== undefined ? { failureThreshold: dto.failureThreshold } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      select: PUBLIC_FIELDS,
    });

    await this.events.record({
      companyId,
      integrationId: id,
      providerId: current.provider.id,
      type: INTEGRATION_EVENT_TYPE.CONFIGURATION,
      operation: 'integracao.alterar',
      message: `Integração ${current.code} alterada.`,
      detail: { campos: Object.keys(dto) },
    });

    return updated;
  }

  /** Substitui o conjunto de parâmetros (RF-127). */
  async setParameters(companyId: string, id: string, dto: SetIntegrationParametersDto) {
    const current = await this.findOne(companyId, id);
    this.assertParametersAreNotSecrets(dto.parameters);

    const updated = await this.prisma.db.integration.update({
      where: { id },
      data: { parameters: dto.parameters as Prisma.InputJsonValue },
      select: PUBLIC_FIELDS,
    });

    await this.events.record({
      companyId,
      integrationId: id,
      providerId: current.provider.id,
      type: INTEGRATION_EVENT_TYPE.CONFIGURATION,
      operation: 'integracao.parametros',
      message: `Parâmetros da integração ${current.code} substituídos.`,
      detail: { chaves: Object.keys(dto.parameters) },
    });

    return updated;
  }

  /**
   * Liga a integração (RF-126).
   *
   * Recusa integração sem credencial quando o provedor exige uma: ligar algo
   * que vai falhar em toda chamada só produz ruído no diário e leva a
   * integração à suspensão automática por um motivo que não é o real.
   */
  async activate(companyId: string, id: string) {
    const current = await this.findOne(companyId, id);

    if (current.status === IntegrationStatus.SUSPENSA) {
      throw new ConflictException(
        'Integração suspensa: use /resume, que exige revisar o motivo da suspensão.',
      );
    }
    if (!current.credential) {
      throw new BadRequestException(
        'Integração sem credencial não pode ser ativada: cadastre a credencial e vincule-a antes.',
      );
    }

    const result = await this.transition(companyId, id, {
      status: IntegrationStatus.ATIVA,
      isActive: true,
      suspensionReason: null,
      failureStreak: 0,
    });

    await this.events.record({
      companyId,
      integrationId: id,
      providerId: current.provider.id,
      type: INTEGRATION_EVENT_TYPE.CONFIGURATION,
      operation: 'integracao.ativar',
      message: `Integração ${current.code} ativada.`,
    });

    return result;
  }

  /** Suspende por decisão humana, com motivo registrado (RF-126/RF-128). */
  async suspend(companyId: string, id: string, dto: SuspendIntegrationDto) {
    const current = await this.findOne(companyId, id);

    const result = await this.transition(companyId, id, {
      status: IntegrationStatus.SUSPENSA,
      suspensionReason: dto.reason,
    });

    await this.events.record({
      companyId,
      integrationId: id,
      providerId: current.provider.id,
      type: INTEGRATION_EVENT_TYPE.SUSPENSION,
      severity: 'AVISO',
      operation: 'integracao.suspender',
      message: `Integração ${current.code} suspensa: ${dto.reason}`,
    });

    return result;
  }

  /**
   * Retoma uma integração suspensa (RF-128).
   *
   * Zerar `failureStreak` faz parte de retomar: sem isso a próxima falha
   * isolada reabriria a suspensão imediatamente, e quem retomou não teria como
   * saber se o problema voltou ou se só sobrou a contagem antiga.
   */
  async resume(companyId: string, id: string) {
    const current = await this.findOne(companyId, id);
    if (current.status !== IntegrationStatus.SUSPENSA) {
      throw new ConflictException('A integração não está suspensa.');
    }

    const result = await this.transition(companyId, id, {
      status: IntegrationStatus.ATIVA,
      isActive: true,
      suspensionReason: null,
      failureStreak: 0,
    });

    await this.events.record({
      companyId,
      integrationId: id,
      providerId: current.provider.id,
      type: INTEGRATION_EVENT_TYPE.CONFIGURATION,
      operation: 'integracao.retomar',
      message: `Integração ${current.code} retomada após suspensão.`,
      detail: { motivoAnterior: current.suspensionReason },
    });

    return result;
  }

  /**
   * Desativa sem remover (RF-126). O diário aponta para a integração e precisa
   * continuar legível — apagar a linha transformaria o histórico em ids soltos.
   */
  async deactivate(companyId: string, id: string) {
    const current = await this.findOne(companyId, id);

    const result = await this.transition(companyId, id, {
      status: IntegrationStatus.INATIVA,
      isActive: false,
    });

    await this.events.record({
      companyId,
      integrationId: id,
      providerId: current.provider.id,
      type: INTEGRATION_EVENT_TYPE.CONFIGURATION,
      operation: 'integracao.desativar',
      message: `Integração ${current.code} desativada.`,
    });

    return result;
  }

  private async transition(companyId: string, id: string, data: Prisma.IntegrationUpdateInput) {
    // `updateMany` com a empresa no filtro: `update` por id sozinho aceitaria
    // um id de outra empresa se a RLS estivesse desligada por engano.
    const { count } = await this.prisma.db.integration.updateMany({
      where: { id, companyId },
      data: data as Prisma.IntegrationUpdateManyMutationInput,
    });
    if (count === 0) {
      throw new NotFoundException('Integração não encontrada.');
    }
    return this.findOne(companyId, id);
  }

  private async assertCredentialBelongs(
    companyId: string,
    providerId: string,
    credentialId: string,
  ): Promise<void> {
    const credential = await this.prisma.db.integrationCredential.findFirst({
      where: { id: credentialId, companyId, providerId, isActive: true },
      select: { id: true },
    });
    if (!credential) {
      throw new BadRequestException(
        'Credencial inválida: precisa ser da mesma empresa, do mesmo provedor e estar ativa.',
      );
    }
  }

  private assertParametersAreNotSecrets(parameters?: Record<string, unknown>): void {
    if (!parameters) return;
    const offending = Object.keys(parameters).find((key) => SECRET_LIKE_KEY.test(key));
    if (offending) {
      throw new BadRequestException(
        `O parâmetro "${offending}" tem nome de credencial. Segredo se cadastra em /banking/credentials, cifrado (RF-127).`,
      );
    }
  }
}
