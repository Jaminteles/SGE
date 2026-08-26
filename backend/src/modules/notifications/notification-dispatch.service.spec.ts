import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { PermanentJobError } from '../../common/queue/job.types';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationDispatchService } from './notification-dispatch.service';
import { EmailProviderError } from './providers/email-provider.port';
import { EmailProviderResolver } from './providers/email-provider-resolver.service';

const notification = {
  id: '33333333-3333-3333-3333-333333333333',
  channel: NotificationChannel.EMAIL,
  status: NotificationStatus.PENDENTE,
  attempts: 0,
  title: 'Pagamento não foi processado',
  message: 'Ordem de R$ 100,00 terminou em FALHA.',
  recipientEmail: 'financeiro@empresa.com',
  link: null,
};

function buildService(
  options: {
    row?: Record<string, unknown> | null;
    claimed?: number;
    send?: jest.Mock;
  } = {},
) {
  const updates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  let firstUpdate = true;

  const prisma = {
    db: {
      notification: {
        findFirst: jest
          .fn()
          .mockResolvedValue(options.row === undefined ? notification : options.row),
        updateMany: jest.fn((args: { where: never; data: never }) => {
          updates.push(args);
          // A primeira chamada é a reivindicação.
          const count = firstUpdate ? (options.claimed ?? 1) : 1;
          firstUpdate = false;
          return Promise.resolve({ count });
        }),
      },
    },
  } as unknown as PrismaService;

  const send = options.send ?? jest.fn().mockResolvedValue({ delivered: true });
  const email = {
    resolve: jest.fn().mockResolvedValue({
      providerId: 'provider-1',
      provider: { code: 'EMAIL_GENERICO', requiresCredentials: true, send },
      context: { companyId: 'empresa-1', providerCode: 'EMAIL_GENERICO' },
    }),
  } as unknown as EmailProviderResolver;

  return { service: new NotificationDispatchService(prisma, email), updates, send, email };
}

describe('NotificationDispatchService.dispatch', () => {
  it('marca como ENVIADA depois de o provedor aceitar', async () => {
    const { service, updates, send } = buildService();

    await service.dispatch('empresa-1', notification.id);

    expect(send).toHaveBeenCalledTimes(1);
    expect(updates.at(-1)?.data).toMatchObject({ status: NotificationStatus.ENVIADA });
  });

  it('não chama o provedor quando outro worker levou o aviso', async () => {
    const { service, send } = buildService({ claimed: 0 });

    await service.dispatch('empresa-1', notification.id);

    expect(send).not.toHaveBeenCalled();
  });

  it('não reenvia o que já saiu', async () => {
    const { service, send } = buildService({
      row: { ...notification, status: NotificationStatus.ENVIADA },
    });

    await service.dispatch('empresa-1', notification.id);

    expect(send).not.toHaveBeenCalled();
  });

  it('encerra em FALHA quando o provedor recusa de forma permanente', async () => {
    const send = jest
      .fn()
      .mockRejectedValue(new EmailProviderError('endereço inválido', 'RECUSADO', false));
    const { service, updates } = buildService({ send });

    await service.dispatch('empresa-1', notification.id);

    expect(updates.at(-1)?.data).toMatchObject({ status: NotificationStatus.FALHA });
  });

  it('relança a falha transitória para a fila reagendar com backoff', async () => {
    const send = jest
      .fn()
      .mockRejectedValue(new EmailProviderError('serviço fora', 'INDISPONIVEL', true));
    const { service } = buildService({ send });

    await expect(service.dispatch('empresa-1', notification.id)).rejects.toBeInstanceOf(
      EmailProviderError,
    );
  });

  it('registra a tentativa como não entregue quando a empresa não tem provedor', async () => {
    const send = jest.fn().mockResolvedValue({ delivered: false });
    const { service, updates } = buildService({ send });

    await service.dispatch('empresa-1', notification.id);

    expect(updates.at(-1)?.data).toMatchObject({ status: NotificationStatus.FALHA });
  });

  it('id inexistente na empresa é falha permanente, não retentativa', async () => {
    const { service } = buildService({ row: null });

    await expect(service.dispatch('empresa-1', notification.id)).rejects.toBeInstanceOf(
      PermanentJobError,
    );
  });

  it('para no teto de tentativas em vez de insistir para sempre', async () => {
    const { service, updates, send } = buildService({
      row: { ...notification, attempts: 5 },
    });

    await service.dispatch('empresa-1', notification.id);

    expect(send).not.toHaveBeenCalled();
    expect(updates.at(-1)?.data).toMatchObject({ status: NotificationStatus.FALHA });
  });
});
