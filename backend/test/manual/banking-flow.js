/**
 * Exercita o M09 pela API de verdade: login, conta bancária, ordem de pagamento
 * com idempotência, envio pela fila, confirmação manual e importação de extrato.
 */
const { generateCnpj } = require('./cnpj');

const BASE = 'http://localhost:3000/api/v1';
const ok = [];
const fail = [];

function check(label, condition, detail) {
  (condition ? ok : fail).push(label + (detail ? ` — ${detail}` : ''));
  console.log(`${condition ? 'ok  ' : 'FALHOU'} ${label}${detail ? ' — ' + detail : ''}`);
}

async function call(method, path, { token, companyId, body, headers = {}, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(raw ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(companyId ? { 'x-company-id': companyId } : {}),
      ...headers,
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
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
  // --- login ---
  const login = await call('POST', '/auth/login', {
    body: { email: 'admin@sge.local', password: 'ChangeMe!2026' },
  });
  if (login.status !== 200 && login.status !== 201) {
    console.log('login falhou', login.status, JSON.stringify(login.body));
    process.exit(1);
  }
  const token = login.body.accessToken ?? login.body.access_token;
  check('login do super admin', Boolean(token));

  // --- empresa de teste ---
  const company = await call('POST', '/companies', {
    token,
    body: { legalName: 'E2E SPRINT10 LTDA', taxId: generateCnpj() },
  });
  const companyId = company.body?.id;
  check('empresa criada', Boolean(companyId), company.status + '');
  if (!companyId) {
    console.log(JSON.stringify(company.body));
    process.exit(1);
  }

  // --- RF-061: catálogo de provedores ---
  const providers = await call('GET', '/banking/providers', { token, companyId });
  const manual = providers.body?.find?.((p) => p.code === 'MANUAL');
  check('RF-061 catálogo de provedores exposto', Boolean(manual), `${providers.body?.length} provedores`);

  // --- RF-059: conta bancária ---
  const account = await call('POST', '/banking/accounts', {
    token,
    companyId,
    body: {
      description: 'Itaú principal',
      bankCode: '341',
      agency: '1234',
      account: '567890',
      isDefault: true,
      providerId: manual.id,
    },
  });
  const accountId = account.body?.id;
  check('RF-059 conta bancária cadastrada', Boolean(accountId), account.status + '');

  const dup = await call('POST', '/banking/accounts', {
    token,
    companyId,
    body: { description: 'Duplicada', bankCode: '341', agency: '1234', account: '567890' },
  });
  check('RF-059 conta duplicada recusada', dup.status === 409, dup.status + '');

  // --- RF-062/RF-067: ordem de pagamento idempotente ---
  const key = 'e2e-' + Date.now();
  const payment = await call('POST', '/banking/payments', {
    token,
    companyId,
    headers: { 'idempotency-key': key },
    body: {
      bankAccountId: accountId,
      method: 'PIX',
      amount: '1250.90',
      pixKey: 'fornecedor@pix.com',
      description: 'Pagamento e2e',
    },
  });
  const paymentId = payment.body?.id;
  check('RF-062 ordem PIX criada', Boolean(paymentId), payment.status + ' status=' + payment.body?.status);

  const replay = await call('POST', '/banking/payments', {
    token,
    companyId,
    headers: { 'idempotency-key': key },
    body: {
      bankAccountId: accountId,
      method: 'PIX',
      amount: '1250.90',
      pixKey: 'fornecedor@pix.com',
      description: 'Pagamento e2e',
    },
  });
  check(
    'RF-067 mesma chave devolve a mesma ordem, sem criar outra',
    replay.body?.id === paymentId,
    'id=' + replay.body?.id,
  );

  const conflict = await call('POST', '/banking/payments', {
    token,
    companyId,
    headers: { 'idempotency-key': key },
    body: {
      bankAccountId: accountId,
      method: 'PIX',
      amount: '99999.00',
      pixKey: 'outro@pix.com',
    },
  });
  check('RF-067 mesma chave com outro corpo é conflito', conflict.status === 409, conflict.status + '');

  const semChave = await call('POST', '/banking/payments', {
    token,
    companyId,
    body: { bankAccountId: accountId, method: 'PIX', amount: '10.00', pixKey: 'x@pix' },
  });
  check('RF-067 Idempotency-Key é obrigatório', semChave.status === 400, semChave.status + '');

  // --- RF-069: a fila envia ---
  console.log('    aguardando o worker enviar a ordem...');
  let sent = null;
  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    sent = await call('GET', `/banking/payments/${paymentId}`, { token, companyId });
    if (sent.body?.status !== 'ENFILEIRADA' && sent.body?.status !== 'CRIADA') break;
  }
  check('RF-069 worker enviou a ordem pela fila', sent.body?.status === 'ENVIADA', 'status=' + sent.body?.status);

  // --- RF-065: provedor MANUAL não cancela depois do envio ---
  const cancel = await call('POST', `/banking/payments/${paymentId}/cancel`, {
    token,
    companyId,
    body: { reason: 'Desistência do pagamento e2e' },
  });
  check('RF-065 cancelamento recusado onde o provedor não suporta', cancel.status === 409, cancel.status + '');

  // --- RF-064: confirmação manual ---
  const comprovante = 'comprovante-e2e-' + Date.now();
  const confirm = await call('POST', `/banking/payments/${paymentId}/confirm`, {
    token,
    companyId,
    body: { externalId: comprovante },
  });
  check('RF-064 confirmação manual aplicada', confirm.body?.status === 'CONFIRMADA', confirm.status + '');

  const confirmAgain = await call('POST', `/banking/payments/${paymentId}/confirm`, {
    token,
    companyId,
    body: {},
  });
  check(
    'RN-004 confirmar de novo não muda nada',
    confirmAgain.body?.status === 'CONFIRMADA' && confirmAgain.status < 400,
    confirmAgain.status + '',
  );

  // --- RF-068: identificador externo registrado ---
  check('RF-068 identificador externo gravado', confirm.body?.externalId === comprovante);

  // O mesmo identificador nao se repete dentro da empresa: e o que impede a
  // mesma confirmacao do banco de ser lancada duas vezes por engano.
  const outraOrdem = await call('POST', '/banking/payments', {
    token,
    companyId,
    headers: { 'idempotency-key': 'e2e-outra-' + Date.now() },
    body: { bankAccountId: accountId, method: 'PIX', amount: '5.00', pixKey: 'outro@pix.com' },
  });
  await new Promise((r) => setTimeout(r, 7000));
  const reuso = await call('POST', `/banking/payments/${outraOrdem.body?.id}/confirm`, {
    token,
    companyId,
    body: { externalId: comprovante },
  });
  check(
    'RF-068 identificador externo não se repete na empresa',
    reuso.status === 409,
    reuso.status + '',
  );

  // --- RF-060: importação de extrato ---
  const ofx = [
    'OFXHEADER:100',
    '<OFX><BANKTRANLIST>',
    '<DTSTART>20261201000000<DTEND>20261203000000',
    '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261201120000<TRNAMT>-1250.90<FITID>E2E-1<MEMO>PAGAMENTO PIX</STMTTRN>',
    '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261202090000<TRNAMT>3400.00<FITID>E2E-2<MEMO>RECEBIMENTO</STMTTRN>',
    '</BANKTRANLIST><LEDGERBAL><BALAMT>15320.10<DTASOF>20261203000000</LEDGERBAL></OFX>',
  ].join('\n');

  const form = new FormData();
  form.append('bankAccountId', accountId);
  form.append('file', new Blob([ofx], { type: 'application/x-ofx' }), 'extrato.ofx');
  const imported = await fetch(BASE + '/banking/statements/import', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-company-id': companyId },
    body: form,
  });
  const importBody = await imported.json();
  check(
    'RF-060 extrato OFX importado',
    importBody?.importedCount === 2,
    `importados=${importBody?.importedCount} status=${imported.status}`,
  );

  const form2 = new FormData();
  form2.append('bankAccountId', accountId);
  form2.append('file', new Blob([ofx], { type: 'application/x-ofx' }), 'extrato.ofx');
  const again = await fetch(BASE + '/banking/statements/import', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-company-id': companyId },
    body: form2,
  });
  check('RF-060 mesmo arquivo não entra duas vezes', again.status === 409, again.status + '');

  const movimentos = await call('GET', `/banking/bank-transactions?bankAccountId=${accountId}`, {
    token,
    companyId,
  });
  check('RF-060 movimentos consultáveis', movimentos.body?.total === 2, 'total=' + movimentos.body?.total);

  const contaApos = await call('GET', `/banking/accounts/${accountId}`, { token, companyId });
  check(
    'RF-060 saldo da conta veio do extrato',
    contaApos.body?.currentBalance === '15320.1' || String(contaApos.body?.currentBalance) === '15320.1',
    'saldo=' + contaApos.body?.currentBalance,
  );

  // --- RF-066: webhook sem assinatura válida ---
  const webhook = await fetch(`${BASE}/banking/webhooks/SANDBOX/${companyId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': 'sha256=00' },
    body: JSON.stringify({ eventId: 'evt-e2e', paymentId: 'ext-1', status: 'SETTLED' }),
  });
  check('RF-066 webhook com assinatura inválida é recusado', webhook.status === 401, webhook.status + '');

  // --- RN-001: isolamento entre empresas ---
  const outra = await call('POST', '/companies', {
    token,
    body: { legalName: 'E2E OUTRA LTDA', taxId: generateCnpj() },
  });
  const vazamento = await call('GET', `/banking/payments/${paymentId}`, {
    token,
    companyId: outra.body?.id,
  });
  check('RN-001 ordem não é visível de outra empresa', vazamento.status === 404, vazamento.status + '');

  const contasOutra = await call('GET', '/banking/accounts', { token, companyId: outra.body?.id });
  check('RN-001 contas isoladas entre empresas', contasOutra.body?.total === 0, 'total=' + contasOutra.body?.total);

  console.log(`\n=== ${ok.length} verificações ok, ${fail.length} falharam ===`);
  if (fail.length > 0) {
    fail.forEach((f) => console.log('  FALHOU: ' + f));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
