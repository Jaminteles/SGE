# SGE — Backend (Sprint 1: Fundação)

Backend do **Sistema de Gestão Empresarial e Financeira**, implementado conforme a
stack de referência da ERS v1.0: **NestJS + TypeScript + PostgreSQL + Prisma**.

Esta sprint entrega a **Fundação** (Fase 1 do roadmap): cadastro de empresas e
filiais, configurações da empresa, usuários, autenticação, perfis e permissões
(RBAC), isolamento multiempresa e alçadas de aprovação.

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
# 1. Criar/atualizar o banco (uma vez) — a partir da pasta bd/
psql -U postgres -f 00_setup_banco.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 01_schema_core.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 02_schema_financeiro.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 03_schema_contabil_governanca.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 04_ajustes_integracao_backend.sql
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
catálogo com `modulo` = `M01`/`M02`. As permissões em português da carga inicial
de `bd/03` continuam lá, reservadas para os módulos das próximas sprints.

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

## Segurança (RNF aplicados nesta sprint)

- **RNF-001**: senhas com hash **argon2id**.
- **RNF-003**: segredos em `.env` (fora do versionamento).
- **RNF-004**: autorização validada no backend (guards globais) **e** no banco (RLS).
- **RNF-006/007**: cada requisição é uma transação; erro reverte tudo.
- **RNF-008**: paginação e filtros server-side nas listagens.
- **RNF-010**: logs estruturados (pino) com correlation id + trilha de auditoria
  no banco com o usuário responsável (`app.usuario_id`).
- **RNF-012**: testes automatizados das regras críticas (autenticação, RBAC, isolamento, CNPJ).
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
