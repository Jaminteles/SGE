import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';

/** Cabeçalhos usados por provedores para carregar a assinatura HMAC. */
const SIGNATURE_HEADERS = ['x-signature', 'x-hub-signature-256', 'x-webhook-signature'];

/** Corpo maior que isso não é notificação de pagamento. */
const MAX_WEBHOOK_BYTES = 512 * 1024;

/**
 * Recepção de webhooks de provedores financeiros (RF-066).
 *
 * Rota pública: quem chama é o banco, que não tem JWT nosso. O que autentica é a
 * assinatura HMAC conferida contra o segredo da credencial da empresa indicada
 * na URL — `companyId` aqui é seletor, não credencial.
 *
 * Rate limit próprio e mais apertado que o padrão: é o único caminho da API
 * aberto sem autenticação, e um provedor legítimo não manda milhares de eventos
 * por minuto para a mesma empresa.
 */
@ApiTags('Bancos — Webhooks')
@Controller('banking/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post(':providerCode/:companyId')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Receber notificação do provedor financeiro (RF-066)' })
  async receive(
    @Param('providerCode') providerCode: string,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Req() request: RawBodyRequest<Request>,
  ) {
    const rawBody = request.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException('Corpo do webhook ausente.');
    }
    if (rawBody.length > MAX_WEBHOOK_BYTES) {
      throw new BadRequestException('Corpo do webhook excede o tamanho aceito.');
    }
    if (!/^[A-Z0-9_]{2,40}$/.test(providerCode)) {
      throw new BadRequestException('Código de provedor inválido.');
    }

    const receipt = await this.webhooks.receive({
      providerCode,
      companyId,
      rawBody,
      signature: this.readSignature(request),
      headers: flattenHeaders(request),
    });

    // O provedor só precisa saber que a notificação foi aceita; o resultado do
    // processamento é assíncrono e não vai na resposta.
    return { received: true, eventId: receipt.eventId, duplicated: receipt.duplicated };
  }

  private readSignature(request: Request): string | undefined {
    for (const name of SIGNATURE_HEADERS) {
      const value = request.headers[name];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    return undefined;
  }
}

function flattenHeaders(request: Request): Record<string, string> {
  return Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.join(', ') : String(value ?? ''),
    ]),
  );
}
