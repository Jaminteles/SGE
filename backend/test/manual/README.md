# Roteiros de ponta a ponta — M09 (Sprint 10)

Exercitam o módulo bancário contra a **API rodando** e o **banco real**, que é
onde as garantias desta sprint de fato existem: idempotência é índice único, o
envio é um job reivindicado por outro processo e a RLS é política do PostgreSQL.
Nada disso aparece num teste com o Prisma mockado.

Não substituem os testes unitários (`npm test`), que cobrem as regras de decisão.
Aqui o que se verifica é a integração entre elas.

## Como rodar

```bash
npm run build && npm run start:prod
```

Com a API no ar, em outro terminal:

```bash
node test/manual/banking-flow.js
node test/manual/banking-webhooks.js
```

Cada verificação imprime uma linha `ok`/`FALHOU` e o processo termina com código
diferente de zero se alguma falhar.

## O que cada roteiro cobre

| Arquivo | Cobertura |
| --- | --- |
| `banking-flow.js` | RF-059 (conta e duplicidade), RF-061 (catálogo), RF-062/RF-067 (ordem e idempotência: repetição, conflito e chave obrigatória), RF-069 (o worker envia), RF-064/RF-065 (confirmação e cancelamento recusado), RF-068, RF-060 (importação OFX, arquivo repetido, saldo da conta) e RN-001 (isolamento entre empresas) |
| `banking-webhooks.js` | RF-061/RNF-003 (credencial cifrada e segredo que não volta), RF-066 (assinatura válida, forjada e ausente), RN-005 (reentrega deduplicada) e o bloqueio de SSRF no envio |

## Pré-requisitos

- banco migrado até `bd/13` e `npm run db:seed` executado;
- super admin com as credenciais padrão de `.env.example`;
- `WORKER_ENABLED=true` (padrão) — sem o worker, a verificação de RF-069 falha
  por tempo esgotado, que é exatamente o sintoma correto.

Os roteiros criam empresas próprias a cada execução e não interferem em dados
existentes. Eles **não** limpam o que criam: rode-os em base de desenvolvimento.
