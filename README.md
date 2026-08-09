# SGE
Sistema de Gestão Empresarial e Financeira

Monorepo baseado na ERS v1.0 (`docs/`). Stack de referência: NestJS + TypeScript +
PostgreSQL + Prisma (backend) e React + TypeScript (frontend, sprints futuras).

## Estrutura

- [`backend/`](backend/README.md) — API REST (NestJS). **Sprint 1 — Fundação** implementada.
- `docs/` — ERS e planejamento de sprints.

## Sprint 1 — Fundação (Fase 1)

Cadastro de empresas/filiais/configurações (M01) e usuários/perfis/permissões (M02),
com autenticação, RBAC, isolamento multiempresa e alçadas. Ver
[backend/README.md](backend/README.md) para instruções de execução e o mapa
requisito → endpoint.
