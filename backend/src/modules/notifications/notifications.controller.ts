import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationChannel } from '@prisma/client';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateNotificationDto, QueryNotificationDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/**
 * Notificações internas (RF-119).
 *
 * Toda rota é escopada pela empresa ativa do header **e** pelo usuário
 * autenticado. As duas coisas são necessárias e nenhuma substitui a outra: a
 * empresa é o limite que a RLS impõe no banco, e o usuário é o limite entre
 * pessoas da mesma empresa — trocar o id da notificação na URL não alcança a
 * caixa de entrada de um colega, mesmo com `notifications:READ`.
 *
 * Não há rota de exclusão: notificação não se apaga (bd/16 §8). O que a
 * interface chama de "limpar" é marcar como lida.
 */
@ApiTags('Notificações e Automação')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_READ)
  @ApiOperation({ summary: 'Caixa de entrada do usuário autenticado (RF-119)' })
  findAll(
    @ActiveCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Query() query: QueryNotificationDto,
  ) {
    return this.notifications.findAll(companyId, userId, query);
  }

  @Get('unread-count')
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_READ)
  @ApiOperation({ summary: 'Quantos avisos ainda não foram lidos (RF-119)' })
  async unreadCount(
    @ActiveCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
  ): Promise<{ unread: number }> {
    return { unread: await this.notifications.unreadCount(companyId, userId) };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_CREATE)
  @ApiOperation({ summary: 'Emitir um aviso para usuários da empresa (RF-119/RF-120)' })
  async create(
    @ActiveCompanyId() companyId: string,
    @Body() dto: CreateNotificationDto,
  ): Promise<{ created: number }> {
    // O destinatário é resolvido a partir da associação com a empresa: um id de
    // outra empresa simplesmente não vira destinatário, e a resposta não
    // distingue "não existe" de "não é daqui" (o total criado é o que volta).
    const recipients = [];
    for (const userId of dto.userIds) {
      const recipient = await this.notifications.recipientById(companyId, userId);
      if (recipient) {
        recipients.push(recipient);
      }
    }

    const created = await this.notifications.emit(
      companyId,
      {
        type: dto.type,
        title: dto.title,
        message: dto.message,
        priority: dto.priority,
        entity: dto.entity,
        entityId: dto.entityId,
      },
      recipients,
      dto.channels ?? [NotificationChannel.INTERNO],
    );

    return { created };
  }

  @Post(':id/read')
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_UPDATE)
  @ApiOperation({ summary: 'Marcar o aviso como lido (RF-119)' })
  markRead(
    @ActiveCompanyId() companyId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.markRead(companyId, userId, id);
  }

  @Post('read-all')
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_UPDATE)
  @ApiOperation({ summary: 'Marcar toda a caixa de entrada como lida (RF-119)' })
  markAllRead(@ActiveCompanyId() companyId: string, @CurrentUser('id') userId: string) {
    return this.notifications.markAllRead(companyId, userId);
  }
}
