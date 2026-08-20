import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaymentTransactionsService } from './payment-transactions.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CancelPaymentDto, ConfirmPaymentDto } from './dto/payment-actions.dto';
import { QueryPaymentDto } from './dto/query-payment.dto';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

const MAX_IDEMPOTENCY_KEY = 255;
const MIN_IDEMPOTENCY_KEY = 8;

/**
 * Ordens de pagamento e recebimento (RF-062 a RF-070).
 *
 * `Idempotency-Key` é **obrigatório** na criação, e não opcional como em muitas
 * APIs: sem ela, um duplo clique ou um retry de proxy vira dois pagamentos, e o
 * dinheiro já saiu quando alguém percebe. Com ela, a segunda chamada devolve a
 * mesma ordem (RF-067).
 *
 * Não há `PUT`/`DELETE`: a ordem não se edita nem se apaga. `POST /:id/cancel`
 * cancela com motivo (RF-065), `POST /:id/sync` pergunta a situação ao provedor
 * (RF-064) e `POST /:id/confirm` registra a confirmação feita fora do sistema —
 * esta última com permissão própria, porque é a afirmação que gera a baixa do
 * título.
 */
@ApiTags('Bancos — Pagamentos')
@ApiBearerAuth()
@Controller('banking/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentTransactionsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.PAYMENTS_CREATE)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Chave única da operação, escolhida pelo cliente. Repetir a chave devolve a ordem já criada (RF-067).',
  })
  @ApiOperation({ summary: 'Criar ordem PIX, boleto, TED ou transferência (RF-062/RF-063)' })
  create(
    @ActiveCompanyId() companyId: string,
    @Body() dto: CreatePaymentDto,
    @CurrentUser('id') userId: string,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey?: string,
  ) {
    return this.payments.create(companyId, dto, userId, this.requireKey(idempotencyKey));
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PAYMENTS_READ)
  @ApiOperation({ summary: 'Consultar ordens (paginado, com filtros) — RF-064' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryPaymentDto) {
    return this.payments.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PAYMENTS_READ)
  @ApiOperation({ summary: 'Detalhar ordem, com identificador externo e baixas geradas' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.findOne(companyId, id);
  }

  @Post(':id/sync')
  @RequirePermissions(PERMISSIONS.PAYMENTS_UPDATE)
  @ApiOperation({ summary: 'Perguntar a situação ao provedor e aplicar o retorno (RF-064)' })
  sync(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.sync(companyId, id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.PAYMENTS_DELETE)
  @ApiOperation({ summary: 'Cancelar a ordem, quando o provedor suportar (RF-065)' })
  cancel(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelPaymentDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.payments.cancel(companyId, id, dto, userId);
  }

  @Post(':id/confirm')
  @RequirePermissions(PERMISSIONS.PAYMENTS_APPROVE)
  @ApiOperation({
    summary: 'Registrar confirmação feita fora do sistema — gera a baixa do título (RF-064)',
  })
  confirm(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmPaymentDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.payments.confirmManually(companyId, id, dto, userId);
  }

  /**
   * A chave é escolhida pelo cliente, e por isso é validada aqui: chave curta
   * demais colide entre operações diferentes e transformaria a proteção contra
   * duplicidade em causa de duplicidade.
   */
  private requireKey(value: string | undefined): string {
    const key = value?.trim();
    if (!key) {
      throw new BadRequestException(
        'O header Idempotency-Key é obrigatório na criação de ordens de pagamento.',
      );
    }
    if (key.length < MIN_IDEMPOTENCY_KEY || key.length > MAX_IDEMPOTENCY_KEY) {
      throw new BadRequestException(
        `O header Idempotency-Key deve ter entre ${MIN_IDEMPOTENCY_KEY} e ${MAX_IDEMPOTENCY_KEY} caracteres.`,
      );
    }
    return key;
  }
}
