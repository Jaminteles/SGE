# SGE — Backend (Fases 1 e 2)

Backend do **Sistema de Gestão Empresarial e Financeira**, implementado conforme a
stack de referência da ERS v1.0: **NestJS + TypeScript + PostgreSQL + Prisma**.

- **Sprint 1 — M01/M02**: cadastro de empresas e filiais, configurações da
  empresa, usuários, autenticação, perfis e permissões (RBAC), isolamento
  multiempresa e alçadas de aprovação.
- **Sprint 2 — M16 (Auditoria)**: trilha de eventos com autor, origem e valores
  anterior/posterior, consulta filtrada e proteção contra alteração
  (RF-114 a RF-118).
- **Sprint 3 — M03 (Funcionários e RH)**: cadastro funcional e bancário, cargos,
  departamentos e gestores, histórico de admissão/desligamento e eventos
  administrativos, centro de custo, verbas, reembolsos com comprovante e
  consolidação para folha e contabilidade (RF-013 a RF-021).

## Banco de dados

O modelo físico vive em [`bd/`](../bd) (schema `gestao`) e é a **fonte da
verdade**. O Prisma aqui só **mapeia** as tabelas usadas nesta sprint
(`@map`/`@@map`) — não há migrations do Prisma e `prisma migrate` não deve ser
usado. Mudanças estruturais são feitas nos scripts SQL.

## Requisitos

- Node.js 20+ (validado em 24)
- PostgreSQL 14+ com o banco `gestao_empresarial` criado pelos scripts de `bd/`

## Como rodar

```bash
# 1. Criar o banco — a partir da pasta bd/
# ATENÇÃO: 00_setup_banco.sql APAGA o banco gestao_empresarial e o recria.
psql -U postgres -f 00_setup_banco.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 01_schema_core.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 02_schema_financeiro.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 03_schema_contabil_governanca.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 04_ajustes_integracao_backend.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 05_auditoria_sprint2.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 06_rh_sprint3.sql
```

```bash
# 2. Backend
npm install
cp .env.example .env        # gere segredos fortes para os campos JWT_*
npm run prisma:generate
npm run db:check            # confere schema, RLS e ajustes aplicados
npm run db:seed             # permissões da API + super admin
npm run start:dev
```

- API: `http://localhost:3000/api/v1`
- Swagger/OpenAPI: `http://localhost:3000/api/docs`
- Health: `GET /api/v1/health` (informa também o schema em uso)

## Comandos úteis

| Comando | Descrição |
| --- | --- |
| `npm run build` | Compila o projeto (TypeScript) |
| `npm test` | Testes unitários (regras críticas — RNF-012) |
| `npm run lint` | ESLint + Prettier |
| `npm run prisma:generate` | Gera o Prisma Client a partir do mapeamento |
| `npm run db:check` | Diagnostica se o banco está pronto para a API |
| `npm run db:seed` | Sincroniza permissões e cria o super admin |

## Isolamento multiempresa e RLS

O banco aplica **Row Level Security** em toda tabela com `empresa_id`
(RN-001/RN-002), inclusive para o dono do schema (`FORCE ROW LEVEL SECURITY`).
As políticas comparam `empresa_id` com `current_setting('app.empresa_id')`.

Como `SET LOCAL` só vale dentro de uma transação, **cada requisição roda em uma
transação**:

1. `TenantContextMiddleware` abre a transação e a guarda em `AsyncLocalStorage`;
2. `JwtStrategy` define `app.usuario_id` (alimenta a auditoria — RN-010);
3. `PermissionsGuard` define `app.empresa_id` a partir do header `x-company-id`;
4. `TransactionInterceptor` confirma no sucesso e **reverte em qualquer erro** —
   uma requisição que falha não deixa escrita parcial (RNF-006/007).

Nos services, o acesso ao banco é sempre por **`prisma.db`** (a transação da
requisição). Usar `prisma.<model>` direto ignora o contexto e as consultas
voltam vazias.

## Modelo de acesso

- **Super admin** (`usuario.super_admin`): gerencia **empresas** e **usuários**.
- **RBAC por empresa**: dentro de cada empresa, o acesso é definido por
  **perfis** (`gestao.perfil`) com **permissões** (`recurso:AÇÃO`). O usuário se
  vincula à empresa por uma **associação** (`gestao.usuario_empresa`).
- **Empresa ativa**: rotas por empresa exigem o header `x-company-id` (uuid).

Ao criar uma empresa, um perfil **Administrador** (com todas as permissões da
API) é provisionado automaticamente; associe um usuário a ele para operar a
empresa. Os perfis globais da carga inicial (`ADMINISTRADOR`, `FINANCEIRO`, ...,
com `empresa_id` nulo) aparecem nas listagens e podem ser usados nas
associações, mas não são editáveis pela API.

### Permissões

`gestao.permissao` não tem coluna de código: a chave é a tripla
(`modulo`, `recurso`, `acao`). A API deriva o código `recurso:AÇÃO` e grava seu
catálogo com `modulo` = `M01`/`M02`/`M03`/`M16`. As permissões em português da
carga inicial de `bd/03` continuam lá, reservadas para os módulos das próximas
sprints.

O seed vincula ao perfil de sistema **RH** todas as permissões do M03 **exceto**
`reimbursements:APPROVE`: quem lança a despesa não decide sobre ela (RN-003).
Conceda a aprovação ao perfil que responde pela alçada.

## Mapa de requisitos → endpoints

| RF | Requisito | Endpoints |
| --- | --- | --- |
| RF-001 | Cadastrar/editar/ativar/inativar empresas | `POST/GET/PATCH /companies`, `POST /companies/:id/activate`, `/inactivate` |
| RF-002 | Filiais | `/branches` (CRUD) |
| RF-003 | Dados cadastrais/endereços/inscrições | `PATCH /companies/:id`, `GET/PATCH /companies/current` |
| RF-004 | Associar usuários a empresas | `/memberships` (CRUD) |
| RF-005 | Isolamento por empresa | Header `x-company-id` + `PermissionsGuard` + RLS |
| RF-006 | Categorias, centros de custo, parâmetros | `/categories`, `/cost-centers`, `/settings` |
| RF-007 | Usuários | `/users` (CRUD) |
| RF-008 | Autenticação e sessões | `POST /auth/login`, `/refresh`, `/logout`, `GET /auth/me` |
| RF-009 | Recuperar/alterar credenciais | `POST /auth/forgot-password`, `/reset-password`, `/change-password` |
| RF-010 | Perfis de acesso | `/roles` (CRUD) |
| RF-011 | Permissões por módulo/operação | `GET /permissions`, permissões nos perfis |
| RF-012 | Alçadas de operações críticas | `/approval-thresholds` (CRUD) + `GET /approval-thresholds/evaluate` |
| RF-114 | Registrar criação, alteração, aprovação, pagamento, recebimento e cancelamento | Trigger de DML (`bd/03`) + `AuditService` para eventos de negócio |
| RF-115 | Registrar usuário, data/hora, origem e entidade | `SET LOCAL app.*` no `TenantContextMiddleware` → colunas de `gestao.auditoria` |
| RF-116 | Valores anterior e posterior | `previousValue`/`currentValue`/`changedFields` na resposta |
| RF-117 | Consultar e filtrar auditoria | `GET /audit`, `GET /audit/:id`, `GET /audit/entities/:entity/:entityId` |
| RF-118 | Proteger registros contra alteração | Sem rota de escrita + trigger (`bd/03`) + `REVOKE UPDATE/DELETE` (`bd/05`) |
| RF-013 | Funcionários, dados profissionais e bancários | `/employees` (CRUD) + `/employees/:id/bank-accounts` |
| RF-014 | Cargos, departamentos e gestores | `/positions`, `/departments`, `managerId` em `/employees` |
| RF-015 | Admissão, desligamento e histórico | `POST /employees` (admissão), `POST /employees/:id/terminate`, `GET /employees/:id/events` |
| RF-016 | Funcionário ↔ centro de custo | `costCenterId` em `/employees`, nos eventos e nos itens de reembolso |
| RF-017 | Salários, benefícios e descontos | `/payroll-items` (catálogo) + `/employees/:id/payroll-items` (atribuição) |
| RF-018 | Despesas e reembolsos | `/reimbursements` + `/submit`, `/review`, `/approve`, `/reject` |
| RF-019 | Armazenar comprovantes | `POST/GET /reimbursements/:id/items/:itemId/receipt` |
| RF-020 | Férias, afastamentos e eventos administrativos | `POST /employees/:id/events` |
| RF-021 | Informações para folha e contabilidade | `GET /payroll/summary?competence=YYYY-MM` |

## Contrato da API — pontos de atenção

O banco modela situação com a coluna booleana `ativo`, e não com um enum de
status. A API acompanha:

- **`isActive` (boolean)** no lugar de `status: ACTIVE|INACTIVE`, tanto na
  entrada quanto na saída e no filtro das listagens (`?isActive=false`).
- **Categoria** (`categoria_financeira`) exige `code` e `type` (`PAGAR`/`RECEBER`);
  não existe mais `scope`.
- **Parâmetro** (`parametro_empresa`) usa `scope` = `FINANCEIRO|FISCAL|GERAL` e
  `value` em **jsonb** (aceita número, booleano, string ou objeto).
- **Filial** não tem e-mail/telefone próprios (`gestao.filial` não os modela);
  ganhou `isHeadquarters` e as inscrições estadual/municipal.
- **Endereço** é uma linha de `gestao.endereco`: informe `addressStreet`,
  `addressCity` e `addressState` juntos (as três colunas são obrigatórias).
- **Associação** aceita `branchId` (vazio = todas as filiais) e `isDefault`.
- **Alçada** aceita `name`, `level` e `minApprovers`; o `requiredRoleId` vira uma
  linha em `gestao.alcada_aprovador` e a resposta traz `requiredRoles`.
- **Auditoria** é somente leitura e o `id` vem como **string**: a coluna é
  `bigint` e `JSON.stringify` não serializa `BigInt`. O filtro de período usa
  intervalo semiaberto — `from` inclusivo, `to` exclusivo.
- **Valores monetários** trafegam como **string decimal** (`"1234.56"`), nunca
  como número: `number` em JSON é ponto flutuante binário (RN-012).
- **Datas de RH** (admissão, vigência, despesa, competência) são dias civis:
  `YYYY-MM-DD` (ou `YYYY-MM` na competência), sem hora e sem fuso.

### M03 — o que o cadastro não deixa você escrever

| Campo | Quem escreve | Por quê |
| --- | --- | --- |
| `employee.status`, `terminationDate`, `baseSalary` | Trigger de `funcionario_evento` (`bd/06`) | O histórico é a fonte; o cadastro é a projeção. Editar direto faria os dois divergirem |
| `reimbursement.number` | `fn_proximo_numero_reembolso` (`bd/06`) | Sequencial por empresa e ano, serializado na transação |
| `reimbursement.totalAmount` | Trigger de `reembolso_item` (`bd/06`) | É a soma das despesas — valor vindo do cliente não é valor |

Consequências no uso: a admissão é registrada junto com `POST /employees`; o
desligamento vai por `POST /employees/:id/terminate` (que também grava o
motivo); férias, afastamento, retorno, promoção, transferência e alteração
salarial vão por `POST /employees/:id/events`. Eventos são **append-only** — o
banco recusa `UPDATE`/`DELETE`, e a correção é um novo evento.

### Reembolso: fluxo e barreiras (RF-018/RF-019)

`RASCUNHO → SOLICITADO → EM_ANALISE → APROVADO | REPROVADO`, com `CANCELADO`
disponível até a aprovação e `PAGO` reservado à liquidação financeira (M08).

- `submit` exige comprovante em **todas** as despesas (RF-019);
- aprovar exige `reimbursements:APPROVE`, **alçada** compatível com o valor
  (operação `REEMBOLSO` em `/approval-thresholds`) e **não ser o solicitante**;
- o valor aprovado nunca pode superar o solicitado;
- comprovante aceita apenas **PDF, JPEG e PNG**, conferidos pela assinatura do
  arquivo, e o mesmo arquivo (hash igual) não é aceito duas vezes na empresa —
  é o sinal mais barato de despesa lançada em duplicidade.

### Auditoria — o que grava o quê (M16)

| Evento | Quem grava | Sobrevive a rollback? |
| --- | --- | --- |
| `CRIACAO`, `ALTERACAO`, `EXCLUSAO` | Trigger de DML nas tabelas críticas (`bd/03`) | Não — acompanha a transação |
| `LOGIN`, `LOGOUT`, e futuros `APROVACAO`/`PAGAMENTO`/... | `AuditService.record()` | Não — acompanha a transação |
| `ACESSO_NEGADO` | `AuditService.recordOutOfBand()` | **Sim** — gravado fora da transação |

A distinção importa: o `TenantContextMiddleware` reverte a transação da
requisição em respostas 4xx/5xx. Um evento de segurança gravado dentro dela
desapareceria exatamente no caso que mais interessa auditar. Em contrapartida,
eventos de sucesso *devem* reverter junto — não houve o fato que descrevem.

Eventos anteriores à escolha da empresa (login) ficam sem `empresa_id` e, por
isso, **não aparecem** na trilha de nenhum tenant: a política de RLS de `bd/05` é
estrita, para não vazar atividade entre empresas.

## Segurança (RNF aplicados nesta sprint)

- **RNF-001**: senhas com hash **argon2id**.
- **RNF-003**: segredos em `.env` (fora do versionamento).
- **RNF-004**: autorização validada no backend (guards globais) **e** no banco (RLS).
- **RNF-006/007**: cada requisição é uma transação; erro reverte tudo.
- **RNF-008**: paginação e filtros server-side nas listagens.
- **RNF-010**: logs estruturados (pino) com correlation id + trilha de auditoria
  no banco com o usuário responsável (`app.usuario_id`). O mesmo correlation id
  vai para `auditoria.correlation_id`, ligando log e trilha.
- **RN-010**: a trilha é *append-only* em três camadas — ausência de rota de
  escrita, trigger que rejeita `UPDATE`/`DELETE` e retirada do privilégio da role
  da aplicação. Hashes de senha e de token são removidos do valor auditado.
- **RNF-012**: testes automatizados das regras críticas (autenticação, RBAC,
  isolamento, CPF/CNPJ, máquina de estados e alçada do reembolso, armazenamento
  de comprovantes).
- **RN-001 estrutural (Sprint 3)**: as referências do M03 usam **FK composta**
  `(empresa_id, <coluna>)`. A verificação de chave estrangeira roda no sistema,
  sem RLS: sem isso, um defeito na API poderia vincular funcionário da empresa A
  ao centro de custo da empresa B. Como FK composta não aceita `ON DELETE SET
  NULL` no PostgreSQL 14, o que era `SET NULL` virou `RESTRICT` — cadastro em
  uso é **inativado**, não removido.
- **Segregação de dados sensíveis**: dado bancário (`employee-bank-accounts`),
  remuneração (`compensation`) e folha (`payroll`) são recursos com permissão
  própria — quem mantém o cadastro funcional não recebe nenhum dos três por
  tabela. `GET /payroll/summary` é registrado na trilha como `EXPORTACAO`.
- **Upload de comprovantes**: a chave de armazenamento é gerada pelo servidor
  (empresa + uuid), o caminho é conferido contra a raiz configurada, o tipo é
  validado pela assinatura do arquivo e o download responde sempre como
  `attachment`.
- Extras: Helmet, CORS restrito, rate limiting, versionamento de API, tratamento padronizado de erros.

## Observações

- A API conecta com o usuário `sge_api` (criado em `bd/04`), que **está sujeito à
  RLS**. Não use `gestao_owner` na aplicação.
- O envio de e-mail da recuperação de senha (RF-009) pertence ao módulo de
  Notificações (M17, sprint futura). Nesta fase o token é registrado em log.
- Rotação de refresh token com detecção de reuso e revogação server-side de sessões.
- Trocar/redefinir a senha grava `usuario.senha_alterada_em` e **invalida os
  access tokens já emitidos** — revogar as sessões sozinho não bastaria, porque
  o access token é stateless e valeria até expirar (RF-009).
- A transação por requisição mantém uma conexão ocupada enquanto a requisição
  dura; `REQUEST_TX_TIMEOUT_MS` limita esse tempo.
