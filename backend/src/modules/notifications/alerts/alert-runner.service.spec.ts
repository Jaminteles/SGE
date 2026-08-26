import { JobStatus, NotificationChannel } from '@prisma/client';
import { AutomationRulesService, CompiledRule } from '../automation-rules.service';
import { NotificationsService } from '../notifications.service';
import { AlertDefinition, AlertRunnerService } from './alert-runner.service';

interface EmitCall {
  recipients: { userId: string | null }[];
  channels: NotificationChannel[];
}

function buildRunner(compiled: CompiledRule[] = []) {
  const emitted: EmitCall[] = [];
  const runs: { ruleId: string; status: JobStatus }[] = [];

  const rules = {
    compiledFor: jest.fn().mockResolvedValue(compiled),
    recordRun: jest.fn((_companyId: string, ruleId: string, status: JobStatus) => {
      runs.push({ ruleId, status });
      return Promise.resolve();
    }),
  } as unknown as AutomationRulesService;

  const notifications = {
    emit: jest.fn(
      (
        _companyId: string,
        _input: unknown,
        recipients: { userId: string | null }[],
        channels: NotificationChannel[],
      ) => {
        emitted.push({ recipients, channels });
        return Promise.resolve(recipients.length);
      },
    ),
    recipientsWithPermission: jest
      .fn()
      .mockResolvedValue([{ userId: 'aprovador', email: 'a@b.com' }]),
    recipientById: jest.fn().mockResolvedValue({ userId: 'nomeado', email: 'c@d.com' }),
  } as unknown as NotificationsService;

  return { runner: new AlertRunnerService(rules, notifications), emitted, runs, notifications };
}

const definition: AlertDefinition<{ id: string }> = {
  trigger: 'APROVACAO_PENDENTE',
  defaultPermission: 'financial-entries:APPROVE',
  collect: () => Promise.resolve([{ id: 'titulo-1' }]),
  build: () => ({
    type: 'APROVACAO_PENDENTE',
    title: 'Aprovação pendente',
    message: 'Título parado.',
    dedupeKey: 'APROVACAO:titulo:titulo-1:2026-08-26',
  }),
};

describe('AlertRunnerService.run', () => {
  it('avisa mesmo sem regra cadastrada: um sistema que só alerta configurado não alerta', async () => {
    const { runner, emitted, runs, notifications } = buildRunner([]);

    const created = await runner.run('empresa-1', definition);

    expect(created).toBe(1);
    expect(emitted[0].channels).toEqual([NotificationChannel.INTERNO]);
    expect(notifications.recipientsWithPermission).toHaveBeenCalledWith(
      'empresa-1',
      'financial-entries:APPROVE',
    );
    // Regra implícita não é gravada, então não registra execução.
    expect(runs).toHaveLength(0);
  });

  it('usa a permissão que vem com o fato quando o gatilho cobre assuntos diferentes', async () => {
    const { runner, notifications } = buildRunner([]);

    await runner.run('empresa-1', {
      ...definition,
      build: () => ({
        type: 'APROVACAO_PENDENTE',
        title: 'Aprovação pendente',
        message: 'Pedido parado.',
        defaultPermission: 'purchase-orders:APPROVE',
      }),
    });

    expect(notifications.recipientsWithPermission).toHaveBeenCalledWith(
      'empresa-1',
      'purchase-orders:APPROVE',
    );
  });

  it('não alarga a regra cadastrada com a permissão padrão', async () => {
    const { runner, notifications } = buildRunner([
      {
        id: 'regra-1',
        name: 'Só para o diretor',
        conditions: {},
        actions: [{ type: 'NOTIFICAR', channel: NotificationChannel.EMAIL, userIds: ['diretor'] }],
      },
    ]);

    await runner.run('empresa-1', definition);

    expect(notifications.recipientsWithPermission).not.toHaveBeenCalled();
  });

  it('registra a execução da regra cadastrada, inclusive quando não avisa ninguém', async () => {
    const { runner, runs } = buildRunner([
      {
        id: 'regra-1',
        name: 'Vazia',
        conditions: {},
        actions: [{ type: 'NOTIFICAR', channel: NotificationChannel.INTERNO, userIds: [] }],
      },
    ]);

    await runner.run('empresa-1', definition);

    expect(runs).toEqual([{ ruleId: 'regra-1', status: JobStatus.CONCLUIDO }]);
  });

  it('uma consulta que falha não derruba os outros alertas da rodada', async () => {
    const { runner, runs } = buildRunner([
      {
        id: 'regra-1',
        name: 'Quebrada',
        conditions: {},
        actions: [
          {
            type: 'NOTIFICAR',
            channel: NotificationChannel.INTERNO,
            permission: 'financial-entries:APPROVE',
          },
        ],
      },
    ]);

    const created = await runner.run('empresa-1', {
      ...definition,
      collect: () => Promise.reject(new Error('coluna inexistente')),
    });

    expect(created).toBe(0);
    expect(runs).toEqual([{ ruleId: 'regra-1', status: JobStatus.FALHA }]);
  });
});
