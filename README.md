# SGE
Sistema de Gestão Empresarial e Financeira

Monorepo baseado na ERS v1.0 (`docs/`). Stack de referência: NestJS + TypeScript +
PostgreSQL + Prisma (backend) e React + TypeScript (frontend, sprints futuras).

## Estrutura

- [`bd/`](bd) — **modelo físico PostgreSQL** (schema `gestao`), fonte da verdade
  do banco: M01 a M18, RLS multiempresa, triggers de auditoria e regras de negócio.
- [`backend/`](backend/README.md) — API REST (NestJS). **Sprint 1 — Fundação** implementada.
- `docs/` — ERS e planejamento de sprints.

## Banco de dados

Ordem de execução dos scripts (a partir de `bd/`):

| Script | Conteúdo | Executar como |
| --- | --- | --- |
| `00_setup_banco.sql` | **Apaga** e recria o banco `gestao_empresarial` e as roles da aplicação | `postgres` |
| `01_schema_core.sql` | Extensões, domínios, enums, M01–M05 (núcleo, RH, parceiros, estoque) | `gestao_owner` |
| `02_schema_financeiro.sql` | Compras, documentos fiscais, títulos, bancos, conciliação | `gestao_owner` |
| `03_schema_contabil_governanca.sql` | Contabilidade, fiscal, fluxo de caixa, auditoria, RLS, carga inicial | `gestao_owner` |
| `04_ajustes_integracao_backend.sql` | Correções do modelo + ajustes exigidos pela API | `gestao_owner` |
| `05_auditoria_sprint2.sql` | M16: origem na trilha, eventos de negócio, RLS e append-only | `gestao_owner` |
| `06_rh_sprint3.sql` | M03: auditoria de RH, FKs multiempresa, histórico funcional e reembolso | `gestao_owner` |
| `99_smoke_test.sql` | Exercita estoque, títulos e partidas dobradas | `gestao_owner` |

```bash
psql -U postgres -f 00_setup_banco.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 01_schema_core.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 02_schema_financeiro.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 03_schema_contabil_governanca.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 04_ajustes_integracao_backend.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 05_auditoria_sprint2.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 06_rh_sprint3.sql
```

No Windows, `bd/instalar-bd.ps1` executa toda a sequência acima — inclusive o
drop. Ele pede confirmação (digitar o nome do banco) quando o banco já existe;
`-Forcar` pula a pergunta.

> ⚠️ `00_setup_banco.sql` **apaga** o banco `gestao_empresarial` e as roles
> `app_gestao`/`sge_api` antes de recriar. Os scripts `01` a `06` montam o schema
> do zero — não são migrações e não se aplicam sobre um banco já existente.

Não rode os scripts como superusuário: superusuário ignora RLS e o isolamento
multiempresa deixaria de ser exercitado.

## Fase 1 — Fundação

**Sprint 1** — Cadastro de empresas/filiais/configurações (M01) e
usuários/perfis/permissões (M02), com autenticação, RBAC, isolamento
multiempresa (RLS no banco) e alçadas (RF-001 a RF-012).

**Sprint 2** — Auditoria (M16): trilha de eventos registrando autor, data/hora,
origem e entidade, com valores anterior e posterior, consulta filtrada por
período/evento/entidade e proteção do registro contra alteração
(RF-114 a RF-118).

## Fase 2 — Cadastros

**Sprint 3** — Funcionários e RH (M03): cadastro funcional com dados
profissionais e bancários, cargos, departamentos e gestores, histórico de
admissão/desligamento e eventos administrativos, apropriação em centro de
custo, salários/benefícios/descontos, despesas e reembolsos com comprovante e
consolidação para folha e contabilidade (RF-013 a RF-021).

Ver [backend/README.md](backend/README.md) para instruções de execução, o mapa
requisito → endpoint e o contrato da API.
