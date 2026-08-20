/**
 * RF-066 pela API real: credencial cifrada, assinatura HMAC sobre o corpo cru,
 * recepção idempotente e recusa de assinatura forjada.
 */
const { createHmac } = require('node:crypto');
const { generateCnpj } = require('./cnpj');

const BASE = 'http://localhost:3000/api/v1';
const WEBHOOK_SECRET = 'segredo-do-webhook-e2e';
const ok = [];
const fail = [];

function check(label, condition, detail) {
  (condition ? ok : fail).push(label);
  console.log(`${condition ? 'ok  ' : 'FALHOU'} ${label}${detail ? ' — ' + detail : ''}`);
}

async function call(method, path, { token, companyId, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(companyId ? { 'x-company-id': companyId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { status: res.status, body: payload };
}

async function postWebhook(companyId, rawBody, signature) {
  const res = await fetch(`${BASE}/banking/webhooks/SANDBOX/${companyId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(signature ? { 'x-signature': signature } : {}) },
    body: rawBody,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { status: res.status, body: payload };
}

async function main() {
  const login = await call('POST', '/auth/login', {
    body: { email: 'admin@sge.local', password: 'ChangeMe!2026' },
  });
  const token = login.body.accessToken;

  const company = await call('POST', '/companies', {
    token,
    body: { legalName: 'E2E WEBHOOK LTDA', taxId: generateCnpj() },
  });
  const companyId = company.body.id;

  const providers = await call('GET', '/banking/providers', { token, companyId });
  const sandbox = providers.body.find((p) => p.code === 'SANDBOX');
  check('RF-061 provedor SANDBOX disponível', Boolean(sandbox));

  // --- RNF-003: o segredo entra e não sai ---
  const credential = await call('POST', '/banking/credentials', {
    token,
    companyId,
    body: {
      providerId: sandbox.id,
      name: 'Homologação',
      environment: 'SANDBOX',
      secret: {
        baseUrl: 'https://api.banco.example',
        apiKey: 'chave-secreta',
        webhookSecret: WEBHOOK_SECRET,
      },
    },
  });
  check('RF-061 credencial cadastrada', credential.status === 201, credential.status + '');
  check(
    'RNF-003 a API não devolve o segredo',
    !JSON.stringify(credential.body).includes('chave-secreta') &&
      !JSON.stringify(credential.body).includes(WEBHOOK_SECRET),
  );

  const listed = await call('GET', '/banking/credentials', { token, companyId });
  check(
    'RNF-003 o segredo também não aparece na listagem',
    !JSON.stringify(listed.body).includes(WEBHOOK_SECRET),
  );

  // --- RF-066: assinatura válida é aceita ---
  const payload = JSON.stringify({
    eventId: 'evt-e2e-' + Date.now(),
    event: 'payment.settled',
    paymentId: 'ext-inexistente',
    status: 'SETTLED',
  });
  const signature = 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');

  const accepted = await postWebhook(companyId, payload, signature);
  check('RF-066 webhook assinado é aceito', accepted.status === 202, accepted.status + '');
  check('RF-066 evento registrado', Boolean(accepted.body?.eventId));

  // --- RN-005: reentrega não vira segundo evento ---
  const repeated = await postWebhook(companyId, payload, signature);
  check(
    'RN-005 reentrega reconhecida como duplicada',
    repeated.status === 202 && repeated.body?.duplicated === true,
    'duplicated=' + repeated.body?.duplicated,
  );
  check(
    'RN-005 a reentrega aponta para o mesmo evento',
    repeated.body?.eventId === accepted.body?.eventId,
  );

  // --- RF-066: assinatura de outro corpo é recusada ---
  const tampered = JSON.stringify({ eventId: 'forjado', paymentId: 'x', status: 'SETTLED' });
  const forged = await postWebhook(companyId, tampered, signature);
  check('RF-066 assinatura de outro corpo é recusada', forged.status === 401, forged.status + '');

  const unsigned = await postWebhook(companyId, payload, undefined);
  check('RF-066 webhook sem assinatura é recusado', unsigned.status === 401, unsigned.status + '');

  // --- SSRF: a URL da credencial é validada no envio ---
  const interna = await call('POST', '/banking/credentials', {
    token,
    companyId,
    body: {
      providerId: sandbox.id,
      name: 'Interna',
      environment: 'PRODUCAO',
      secret: { baseUrl: 'http://169.254.169.254', webhookSecret: 'x' },
    },
  });
  const conta = await call('POST', '/banking/accounts', {
    token,
    companyId,
    body: {
      description: 'Conta SSRF',
      bankCode: '341',
      agency: '4321',
      account: '111222',
      providerId: sandbox.id,
      credentialId: interna.body.id,
    },
  });
  const ordem = await fetch(BASE + '/banking/payments', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-company-id': companyId,
      'idempotency-key': 'ssrf-' + Date.now(),
    },
    body: JSON.stringify({
      bankAccountId: conta.body.id,
      method: 'PIX',
      amount: '10.00',
      pixKey: 'a@pix',
    }),
  });
  const ordemBody = await ordem.json();
  check('ordem para destino interno é aceita na criação', ordem.status === 201, ordem.status + '');

  // O bloqueio acontece no envio, e o erro e definitivo: insistir nao mudaria
  // o destino. A ordem termina em FALHA, sem nunca ter saido.
  console.log('    aguardando o worker tentar enviar para o destino interno...');
  let final = null;
  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    final = await call('GET', `/banking/payments/${ordemBody.id}`, { token, companyId });
    if (final.body?.status !== 'ENFILEIRADA') break;
  }
  check(
    'SSRF: envio para endereço interno termina em FALHA, não sai',
    final.body?.status === 'FALHA' && final.body?.errorCode === 'DESTINO_INVALIDO',
    `status=${final.body?.status} erro=${final.body?.errorCode}`,
  );

  console.log(`\n=== ${ok.length} verificações ok, ${fail.length} falharam ===`);
  if (fail.length > 0) {
    fail.forEach((f) => console.log('  FALHOU: ' + f));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
