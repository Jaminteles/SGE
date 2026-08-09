# SGE — Backend (Sprint 1: Fundação)

Backend do **Sistema de Gestão Empresarial e Financeira**, implementado conforme a
stack de referência da ERS v1.0: **NestJS + TypeScript + PostgreSQL + Prisma**.

Esta sprint entrega a **Fundação** (Fase 1 do roadmap): cadastro de empresas e
filiais, configurações da empresa, usuários, autenticação, perfis e permissões
(RBAC), isolamento multiempresa e alçadas de aprovação.

## Requisitos

- Node.js 20+ (validado em 24)
- PostgreSQL 16 (via Docker ou instância própria)

## Como rodar

```bash
# 1. Instalar dependências
npm install

# 2. Configurar o ambiente (gere segredos fortes para os campos JWT_*)
cp .env.example .env

# 3. Subir o PostgreSQL
docker compose up -d

# 4. Aplicar o schema no banco
npm run prisma:deploy   # produção / CI (usa as migrations)
# ou, em desenvolvimento:
npm run prisma:migrate

# 5. Popular permissões + super admin inicial
npm run db:seed

# 6. Iniciar a API
npm run start:dev
```

- API: `http://localhost:3000/api/v1`
- Swagger/OpenAPI: `http://localhost:3000/api/docs`
- Health: `GET /api/v1/health`

## Comandos úteis

| Comando | Descrição |
| --- | --- |
| `npm run build` | Compila o projeto (TypeScript) |
| `npm test` | Testes unitários (regras críticas — RNF-012) |
| `npm run lint` | ESLint + Prettier |
| `npm run prisma:generate` | Gera o Prisma Client |
| `npm run db:seed` | Sincroniza permissões e cria o super admin |

## Modelo de acesso

- **Super admin** (administrador de plataforma): gerencia **empresas** e **usuários**.
- **RBAC por empresa**: dentro de cada empresa, o acesso é definido por
  **perfis** (roles) com **permissões** (`recurso:AÇÃO`). O usuário se vincula à
  empresa por uma **associação** (membership) que carrega o perfil.
- **Empresa ativa**: rotas por empresa exigem o header `x-company-id`. O
  `PermissionsGuard` valida a associação do usuário àquela empresa antes de
  autorizar (isolamento multiempresa — RF-005).

Ao criar uma empresa, um perfil **Administrador** (com todas as permissões) é
provisionado automaticamente; associe um usuário a ele para operar a empresa.

## Mapa de requisitos → endpoints

| RF | Requisito | Endpoints |
| --- | --- | --- |
| RF-001 | Cadastrar/editar/ativar/inativar empresas | `POST/GET/PATCH /companies`, `POST /companies/:id/activate`, `/inactivate` |
| RF-002 | Filiais | `/branches` (CRUD) |
| RF-003 | Dados cadastrais/endereços/inscrições | `PATCH /companies/:id`, `GET/PATCH /companies/current` |
| RF-004 | Associar usuários a empresas | `/memberships` (CRUD) |
| RF-005 | Isolamento por empresa | Header `x-company-id` + `PermissionsGuard` |
| RF-006 | Categorias, centros de custo, parâmetros | `/categories`, `/cost-centers`, `/settings` |
| RF-007 | Usuários | `/users` (CRUD) |
| RF-008 | Autenticação e sessões | `POST /auth/login`, `/refresh`, `/logout`, `GET /auth/me` |
| RF-009 | Recuperar/alterar credenciais | `POST /auth/forgot-password`, `/reset-password`, `/change-password` |
| RF-010 | Perfis de acesso | `/roles` (CRUD) |
| RF-011 | Permissões por módulo/operação | `GET /permissions`, permissões nos perfis |
| RF-012 | Alçadas de operações críticas | `/approval-thresholds` (CRUD) + `GET /approval-thresholds/evaluate` |

## Segurança (RNF aplicados nesta sprint)

- **RNF-001**: senhas com hash **argon2id**.
- **RNF-003**: segredos em `.env` (fora do versionamento).
- **RNF-004**: autorização validada no backend (guards globais).
- **RNF-006/007**: operações compostas em transações (ex.: provisionamento da empresa, reset de senha).
- **RNF-008**: paginação e filtros server-side nas listagens.
- **RNF-010**: logs estruturados (pino) com correlation id.
- **RNF-012**: testes automatizados das regras críticas (autenticação, RBAC, isolamento, CNPJ).
- Extras: Helmet, CORS restrito, rate limiting, versionamento de API, tratamento padronizado de erros.

## Observações

- O envio de e-mail da recuperação de senha (RF-009) pertence ao módulo de
  Notificações (M17, sprint futura). Nesta fase o token é registrado em log.
- Rotação de refresh token com detecção de reuso e revogação server-side de sessões.
