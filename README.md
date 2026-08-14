# SGE
Sistema de Gestão Empresarial e Financeira

Monorepo baseado na ERS v1.0 (`docs/`). Stack de referência: NestJS + TypeScript +
PostgreSQL + Prisma (backend) e React + TypeScript (frontend, sprints futuras).

## Estrutura

- [`bd/`](bd) — **modelo físico PostgreSQL** (schema `gestao`), fonte da verdade
  do banco: M01 a M18, RLS multiempresa, triggers de auditoria e regras de negócio.
- [`backend/`](backend/README.md) — API REST (NestJS). Sprints 1 a 6 implementadas.
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
| `07_parceiros_produtos_sprint4.sql` | M04/M05: papéis de cliente/fornecedor, FKs multiempresa e regras do catálogo | `gestao_owner` |
| `08_estoque_sprint5.sql` | M05: razão append-only, custo médio ponderado, saldo não negativo e inventário | `gestao_owner` |
| `09_financeiro_sprint6.sql` | M08: numeração de títulos, parcelas que somam o título, encargos, aprovação e baixa append-only | `gestao_owner` |
| `99_smoke_test.sql` | Exercita estoque, títulos e partidas dobradas | `gestao_owner` |

```bash
psql -U postgres -f 00_setup_banco.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 01_schema_core.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 02_schema_financeiro.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 03_schema_contabil_governanca.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 04_ajustes_integracao_backend.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 05_auditoria_sprint2.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 06_rh_sprint3.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 07_parceiros_produtos_sprint4.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 08_estoque_sprint5.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 09_financeiro_sprint6.sql
```

No Windows, `bd/instalar-bd.ps1` executa toda a sequência acima — inclusive o
drop. Ele pede confirmação (digitar o nome do banco) quando o banco já existe;
`-Forcar` pula a pergunta.

Para levar um banco **já existente** até a sprint atual **sem perder os dados**,
use o modo de atualização: ele não apaga nada, não pede a senha do superusuário
e reaplica só os scripts de ajuste (`04` a `09`), que são idempotentes.

```bash
pwsh bd/instalar-bd.ps1 -Atualizar
```

Depois, em `backend/`: `npm run db:seed` (permissões novas) e `npm run db:check`.

> ⚠️ `00_setup_banco.sql` **apaga** o banco `gestao_empresarial` e as roles
> `app_gestao`/`sge_api` antes de recriar. Os scripts `01` a `03` montam o schema
> do zero — não são migrações e não se aplicam sobre um banco já existente. Os
> scripts `04` a `09` são ajustes idempotentes: esses, sim, podem ser reaplicados
> sobre um banco com dados (é o que faz `instalar-bd.ps1 -Atualizar`).

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

**Sprint 4** — Clientes e Fornecedores (M04) e início de Produtos e Serviços
(M05): cadastro PF/PJ com papéis de cliente e fornecedor, contatos, endereços e
dados bancários, histórico comercial e financeiro, condições e formas de
pagamento, cadastro de produtos e serviços com unidade, categoria, preço e
dados fiscais (NCM/CEST), e associação de fornecedores aos itens
(RF-022 a RF-030).

**Sprint 5** — Estoque (M05): locais de estoque por filial, saldo e custo médio
ponderado por local, entradas, saídas, transferências e ajustes num razão
append-only, inventário com contagem e ajuste, valorização e alerta de estoque
mínimo (RF-031 a RF-035).

## Fase 3 — Financeiro

**Sprint 6** — Contas a Pagar e Receber (M08): títulos das duas carteiras
criados manualmente ou a partir de outros processos, parcelas e recorrências,
classificação por categoria, conta contábil e centro de custo, controle de
vencimento, juros, multa e descontos, aprovação por alçada, pagamento e
recebimento total ou parcial com estorno, e acompanhamento de inadimplência
(RF-051 a RF-058).

Ver [backend/README.md](backend/README.md) para instruções de execução, o mapa
requisito → endpoint e o contrato da API.
