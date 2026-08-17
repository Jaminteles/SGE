# SGE
Sistema de Gestão Empresarial e Financeira

Monorepo baseado na ERS v1.0 (`docs/`). Stack de referência: NestJS + TypeScript +
PostgreSQL + Prisma (backend) e React + TypeScript (frontend).

O planejamento tem **24 sprints**: as 17 primeiras entregam o backend módulo a
módulo (RF-001 a RF-131) e as **Sprints 18 a 24 entregam a interface web** das
telas correspondentes (Fase 9, itens `UI-xxx` na planilha). Até lá o sistema é
consumido pela API — Swagger em `/api/docs`.

## Estrutura

- [`bd/`](bd) — **modelo físico PostgreSQL** (schema `gestao`), fonte da verdade
  do banco: M01 a M18, RLS multiempresa, triggers de auditoria e regras de negócio.
- [`backend/`](backend/README.md) — API REST (NestJS). Sprints 1 a 7 implementadas.
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
| `10_fluxo_caixa_sprint7.sql` | M14: fluxo consolidado (realizado, previsto e vencido), cenários com premissas, projeção manual e alerta de caixa | `gestao_owner` |
| `11_compras_sprint8.sql` | M06: numeração do pedido e do recebimento, total projetado dos itens com rateio de despesas, aprovação, recebimento append-only, divergências e histórico de preços | `gestao_owner` |
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
psql -U gestao_owner -h localhost -d gestao_empresarial -f 10_fluxo_caixa_sprint7.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 11_compras_sprint8.sql
```

No Windows, `bd/instalar-bd.ps1` executa toda a sequência acima — inclusive o
drop. Ele pede confirmação (digitar o nome do banco) quando o banco já existe;
`-Forcar` pula a pergunta.

Para levar um banco **já existente** até a sprint atual **sem perder os dados**,
use o modo de atualização: ele não apaga nada, não pede a senha do superusuário
e reaplica só os scripts de ajuste (`04` a `11`), que são idempotentes.

```bash
pwsh bd/instalar-bd.ps1 -Atualizar
```

Depois, em `backend/`: `npm run db:seed` (permissões novas) e `npm run db:check`.

> ⚠️ `00_setup_banco.sql` **apaga** o banco `gestao_empresarial` e as roles
> `app_gestao`/`sge_api` antes de recriar. Os scripts `01` a `03` montam o schema
> do zero — não são migrações e não se aplicam sobre um banco já existente. Os
> scripts `04` a `11` são ajustes idempotentes: esses, sim, podem ser reaplicados
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

**Sprint 7** — Fluxo de Caixa e Planejamento (M14): consolidação das entradas e
saídas previstas e realizadas, projeção por dia, semana ou mês com saldo
acumulado, separação entre realizado, previsto e vencido, cenários com premissas
e movimentos projetados à mão, e alerta de insuficiência de caixa
(RF-101 a RF-105).

## Fase 4 — Compras e Documentos

**Sprint 8** — Compras (M06): pedidos de compra com itens, quantidades, preços,
descontos e frete rateado, submissão a aprovação por alçada, recebimento total
ou parcial com conferência de quantidade e preço, vínculo do pedido com
fornecedor, estoque e financeiro, e histórico de compras e de preços
(RF-036 a RF-042).

## Fase 9 — Interface Web (Sprints 18 a 24)

O frontend (React + TypeScript) não tem requisito próprio na ERS: são as telas
dos RF já entregues pelo backend, planejadas como itens `UI-001` a `UI-039`.

| Sprint | Entrega |
| --- | --- |
| 18 | Fundação: projeto, autenticação, empresa ativa, RBAC na interface e componentes base |
| 19 | Administração: empresas, filiais, usuários, perfis, alçadas e auditoria (M01/M02/M16) |
| 20 | RH: funcionários, histórico, verbas e reembolsos (M03) |
| 21 | Parceiros, catálogo e estoque (M04/M05) |
| 22 | Financeiro: contas a pagar/receber, baixas, inadimplência e fluxo de caixa (M08/M14) |
| 23 | Compras, documentos fiscais e bancário (M06/M07/M09/M10) |
| 24 | Contábil, fiscal, automação, dashboards e integrações (M11/M12/M13/M15/M17/M18) |

As datas na planilha seguem a Sprint 17 em sequência, o que **pressupõe uma
equipe só**. Com uma segunda equipe, cada sprint de interface pode correr em
paralelo assim que o módulo correspondente estiver pronto no backend — nesse
caso, as datas das Sprints 18 a 24 precisam ser refeitas.

Ver [backend/README.md](backend/README.md) para instruções de execução, o mapa
requisito → endpoint e o contrato da API.
