import { isIP } from 'node:net';

/**
 * Validação do destino de uma chamada externa (SSRF).
 *
 * Toda integração deste sistema aponta para uma URL que veio de cadastro — a
 * credencial da empresa (M09) ou a do provedor de OCR (M13). Uma URL cadastrada
 * é entrada de usuário: sem as barreiras abaixo, um `baseUrl` apontando para
 * `http://169.254.169.254` transforma o adaptador em SSRF com as credenciais da
 * infraestrutura.
 *
 * Vive em `common` porque o controle não é do módulo bancário: é de qualquer
 * adaptador que chame para fora. Duplicá-lo por módulo garantiria que um deles
 * ficasse para trás.
 */

/** Motivo da recusa, no vocabulário que os adaptadores já usam. */
export type OutboundUrlErrorCode =
  'CREDENCIAL_INCOMPLETA' | 'CREDENCIAL_INVALIDA' | 'DESTINO_INVALIDO' | 'DESTINO_NAO_PERMITIDO';

export class OutboundUrlError extends Error {
  constructor(
    message: string,
    readonly code: OutboundUrlErrorCode,
  ) {
    super(message);
    this.name = 'OutboundUrlError';
  }
}

export interface OutboundUrlOptions {
  /** Hosts liberados. Vazio = só o piso de rede privada abaixo. */
  allowedHosts: string[];
  /** Fora de produção o `http://` do sandbox local continua valendo. */
  allowInsecure: boolean;
}

/**
 * Resolve `path` sobre `baseUrl` e recusa o que não deve ser alcançado.
 *
 * Três barreiras: só HTTPS (fora de desenvolvimento), host em allowlist quando
 * houver uma, e nunca endereço de loopback, link-local ou rede privada.
 */
export function resolveOutboundUrl(
  baseUrl: string | undefined,
  path: string,
  options: OutboundUrlOptions,
): string {
  if (!baseUrl) {
    throw new OutboundUrlError(
      'A credencial não informa a URL do provedor.',
      'CREDENCIAL_INCOMPLETA',
    );
  }

  let url: URL;
  try {
    url = new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  } catch {
    throw new OutboundUrlError('A credencial tem URL inválida.', 'CREDENCIAL_INVALIDA');
  }

  if (url.protocol !== 'https:' && !(options.allowInsecure && url.protocol === 'http:')) {
    throw new OutboundUrlError('A integração exige HTTPS.', 'DESTINO_INVALIDO');
  }

  const host = url.hostname.toLowerCase();
  if (options.allowedHosts.length > 0 && !options.allowedHosts.includes(host)) {
    throw new OutboundUrlError(
      `Destino ${host} não está na lista de hosts permitidos.`,
      'DESTINO_NAO_PERMITIDO',
    );
  }
  if (isPrivateHost(host)) {
    throw new OutboundUrlError(
      'A integração não pode apontar para um endereço interno.',
      'DESTINO_INVALIDO',
    );
  }

  return url.toString();
}

/**
 * Endereço que não deve ser alcançado a partir de uma credencial cadastrada.
 *
 * A checagem é sobre o host literal — resolução de DNS pode mudar entre a
 * validação e a chamada (rebinding). Por isso a allowlist de hosts é o controle
 * principal em produção, e esta função é o piso mínimo quando ela não existe.
 */
export function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return true;
  }
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (isIP(host) === 6) {
    const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
    return (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fe80') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd')
    );
  }
  return false;
}

/** Lê a allowlist e o modo inseguro da configuração compartilhada (RNF-011). */
export function outboundUrlOptions(read: (key: string) => string | undefined): OutboundUrlOptions {
  return {
    allowedHosts: (read('INTEGRATION_ALLOWED_HOSTS') ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    allowInsecure: read('NODE_ENV') !== 'production',
  };
}
