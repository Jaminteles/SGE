# SGE — Backend (Fases 1 a 3 completas)

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
- **Sprint 4 — M04 (Clientes e Fornecedores) + M05 (Produtos e Serviços)**:
  parceiros PF/PJ com papéis de cliente e fornecedor, contatos, endereços e
  dados bancários, histórico comercial e financeiro, formas e condições de
  pagamento, catálogo de produtos e serviços com dados fiscais e vínculo com
  fornecedores (RF-022 a RF-030).
- **Sprint 5 — M05 (Estoque)**: locais de estoque por filial, saldo e custo médio
  ponderado por local, entradas, saídas, transferências e ajustes num razão
  append-only, inventário com contagem e ajuste, valorização e alerta de estoque
  mínimo (RF-031 a RF-035).
- **Sprint 6 — M08 (Contas a Pagar e Receber)**: títulos das duas carteiras,
  parcelamento e recorrências, classificação por categoria, conta contábil e
  centro de custo, vencimento com juros, multa e desconto, aprovação por alçada,
  pagamento e recebimento total ou parcial com estorno, posição da carteira e
  inadimplência (RF-051 a RF-058).
- **Sprint 7 — M14 (Fluxo de Caixa e Planejamento)**: consolidação de entradas e
  saídas previstas e realizadas, projeção por dia, semana ou mês com saldo
  acumulado, separação entre realizado, previsto e vencido, cenários com
  premissas e movimentos digitados, e alerta de insuficiência de caixa
  (RF-101 a RF-105).

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
psql -U gestao_owner -h localhost -d gestao_empresarial -f 07_parceiros_produtos_sprint4.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 08_estoque_sprint5.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 09_financeiro_sprint6.sql
```

Se o banco já existe e você só quer trazê-lo para a sprint atual **sem perder os
dados**, rode `pwsh ../bd/instalar-bd.ps1 -Atualizar`: reaplica apenas `04` a
`09`, que são idempotentes.

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
catálogo com `modulo` = `M01`/`M02`/`M03`/`M04`/`M05`/`M08`/`M14`/`M16`. As permissões em
português da carga inicial de `bd/03` continuam lá, reservadas para os módulos
das próximas sprints.

Vínculos feitos pelo seed nos perfis de sistema:

| Perfil | Recebe | Não recebe, e por quê |
| --- | --- | --- |
| RH | Todo o M03 | `reimbursements:APPROVE` — quem lança a despesa não decide sobre ela (RN-003) |
| COMPRAS | M04 e o catálogo do M05 | `partner-bank-accounts:*` — quem negocia o preço não redireciona o crédito; `stock-movements:*` e `inventories:*` — quem compra não dá baixa no que chegou |
| FINANCEIRO | Todo o M08, `partner-bank-accounts:*`, leitura de parceiros, histórico, condições, `stock:READ`, `stock-valuation:READ`, `cash-flow:READ` e leitura de cenários e alertas | `financial-entries:APPROVE` — quem lança o título não decide sobre ele (RN-003); escrita do cadastro comercial e do estoque; escrita de cenário e alerta — afrouxar o próprio saldo mínimo é apagar o aviso |
| DIRETOR | Todo o M14 (fluxo, cenários e alertas) + leitura de títulos, baixas e inadimplência | Escrita no M08 — quem planeja o caixa não lança nem baixa título |
| OPERACIONAL | Catálogo, locais, movimentação e contagem do M05 | M04 — catálogo não implica acesso a parceiros; `inventories:APPROVE` — quem conta não homologa a própria diferença (RN-003); `stock-valuation:READ` — valor do ativo é leitura financeira |

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
| RF-022 | Cadastrar clientes PF/PJ | `/partners` (CRUD) com `isCustomer` + bloco `customer` |
| RF-023 | Cadastrar fornecedores PF/PJ | `/partners` (CRUD) com `isSupplier` + bloco `supplier` |
| RF-024 | Contatos, endereços e dados bancários | `/partners/:id/contacts`, `/addresses`, `/bank-accounts` |
| RF-025 | Histórico comercial e financeiro | `GET /partners/:id/history` (+ `GET /audit/entities/parceiro/:id`) |
| RF-026 | Condições e formas de pagamento | `/payment-terms`, `/payment-methods` (CRUD) |
| RF-027 | Associar fornecedores a produtos | `/products/:id/suppliers` (CRUD) + `GET /partners/:id/products` |
| RF-028 | Cadastrar produtos e serviços | `/products` (CRUD) |
| RF-029 | Unidade, código, categoria, custo e preço | `/units-of-measure`, `/product-categories`, campos de `/products` |
| RF-030 | Dados fiscais (NCM, CEST) | `ncm`, `cest`, CFOPs, `goodsOrigin` e `serviceCodeLc116` em `/products` |
| RF-031 | Controlar estoque por filial/local | `/stock-locations` (CRUD), `GET /stock/balances`, `GET /stock/products/:productId` |
| RF-032 | Entradas, saídas, transferências e ajustes | `POST /stock/movements`, `POST /stock/transfers`, `GET /stock/movements` |
| RF-033 | Inventário e histórico | `/inventories` + `/start`, `/counts`, `/close`, `/cancel` |
| RF-034 | Registrar custos | `unitCost` no movimento, `averageCost` no saldo e no item, `GET /stock/valuation` |
| RF-035 | Alertar estoque mínimo | `GET /stock/alerts` (view `vw_estoque_alerta_minimo`) |
| RF-051 | Contas a pagar manuais ou vindas de processos | `POST /financial-entries` com `type=PAGAR` (`origin` = MANUAL/RECORRENCIA/...) |
| RF-052 | Contas a receber manuais ou vindas de processos | `POST /financial-entries` com `type=RECEBER` |
| RF-053 | Parcelas e recorrências | `installments`/`installmentCount`/`paymentTermId` em `/financial-entries`; `/recurrences` + `POST /recurrences/:id/generate` |
| RF-054 | Categoria, conta contábil e centro de custo | `categoryId`, `costCenterId` e `ledgerAccountId` em `/financial-entries` |
| RF-055 | Vencimento, juros, multas e descontos | `PATCH /financial-entries/:id/installments/:installmentId`, `GET /installments` (view `vw_parcela_posicao`) |
| RF-056 | Controlar aprovação | `POST /financial-entries/:id/submit`, `/approve`, `/reject` + `/approval-thresholds` (operação `TITULO_PAGAR`/`TITULO_RECEBER`) |
| RF-057 | Pagamento/recebimento total ou parcial | `POST /financial-entries/:id/installments/:installmentId/settlements` e `.../:settlementId/reverse` |
| RF-058 | Inadimplência e histórico | `GET /delinquency` (view `vw_inadimplencia`), `GET /installments?overdueOnly=true`, `GET /partners/:id/history` |
| RF-101 | Consolidar entradas e saídas previstas e realizadas | `GET /cash-flow/summary` (view `vw_fluxo_caixa_diario`) |
| RF-102 | Projetar fluxo por período | `GET /cash-flow/projection?granularity=DIA\|SEMANA\|MES` |
| RF-103 | Separar realizado, previsto e vencido | `bySituation` no summary e `inflow`/`outflow` por situação na projeção |
| RF-104 | Criar cenários e projeções | `/cash-flow/scenarios` (CRUD) + `/cash-flow/scenarios/:id/projections`; `?scenarioId=` na projeção |
| RF-105 | Alertar insuficiência de caixa | `/cash-flow/alerts` (CRUD), `GET /cash-flow/alerts/evaluation`, `GET /cash-flow/balance` |

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
- **Regras do banco viram 400**, não 500: o que um trigger de `bd/06` a `bd/09`
  recusa (`RAISE EXCEPTION`) chega ao cliente com a mensagem da regra — ciclo de
  hierarquia, papel incompatível, evento imutável, baixa acima do saldo. Violação de RLS (`42501`)
  segue como 500 de propósito: é defeito do servidor, não do chamador.
- **Auditoria** é somente leitura e o `id` vem como **string**: a coluna é
  `bigint` e `JSON.stringify` não serializa `BigInt`. O filtro de período usa
  intervalo semiaberto — `from` inclusivo, `to` exclusivo.
- **Valores monetários** trafegam como **string decimal** (`"1234.56"`), nunca
  como número: `number` em JSON é ponto flutuante binário (RN-012).
- **Datas de RH e do financeiro** (admissão, vigência, despesa, competência,
  emissão, vencimento, baixa) são dias civis: `YYYY-MM-DD` (ou `YYYY-MM` na
  competência), sem hora e sem fuso.
- **Parceiro** é um cadastro só com dois papéis (`isCustomer`/`isSupplier`) —
  pelo menos um é obrigatório. O documento acompanha o `personType`: CNPJ para
  `PJ`, CPF para `PF`, `foreignDocument` para `ESTRANGEIRO`; `personType` não é
  editável depois de criado.
- **Preços unitários** (`salePrice`, `referencePrice`) e **quantidades**
  (`minStock`, `maxStock`) são decimais de até **6 casas**, também em string —
  as colunas são `numeric(18,6)`, não `numeric(18,2)`.

### M04 — papéis, perfis e bloqueio

| Regra | Onde vale |
| --- | --- |
| Parceiro precisa exercer ao menos um papel | Service + CHECK `ck_parceiro_papel` (`bd/01`) |
| Linha de `cliente`/`fornecedor` só para quem tem o papel | Trigger `trg_cliente_papel`/`trg_fornecedor_papel` (`bd/07`) |
| Bloqueio exige motivo | Service + CHECK `ck_cliente_bloqueio`/`ck_fornecedor_bloqueio` (`bd/07`) |
| Um endereço, contato e conta **principal** por parceiro | Service + índices únicos parciais (`bd/07`) |
| Vínculo produto ↔ fornecedor só com quem tem `isSupplier` | Service + `trg_produto_fornecedor_papel` (`bd/07`) |

Desabilitar um papel **não apaga** o perfil: limite de crédito, condição
negociada e motivo de bloqueio são histórico comercial, e reativar o papel
devolve o que já estava acordado.

### M05 — o que o cadastro do item recusa

| Regra | Motivo |
| --- | --- |
| `SERVICO` não controla estoque | Serviço não tem saldo; o banco recusa a combinação (`ck_produto_servico_estoque`) |
| `SERVICO` exige `serviceCodeLc116` | Sem o código da LC 116 o item não é classificável na NFS-e (RF-030) |
| `maxStock` ≥ `minStock`, preços e pesos ≥ 0 | Valor negativo entraria no item da nota e no custo médio |
| NCM 8 dígitos, CEST 7, CFOP 4, origem 0–8 | Formato fixo da NF-e (`ck_produto_fiscal`, `bd/07`) |

`averageCost`, `lastPurchaseCost` e `lastPurchaseDate` são **somente leitura**:
quem escreve `averageCost` é a movimentação de estoque (Sprint 5, via trigger de
`bd/08`); os dois últimos vêm da compra (Sprint 8).

### M05 — Estoque: o razão é a única porta de entrada (RF-031 a RF-035)

Saldo e custo médio **não são escritos pela API**. Todo movimento entra em
`gestao.movimento_estoque` e o banco projeta `gestao.estoque_saldo` e
`produto.custo_medio` por trigger (`bd/08`). A garantia é de privilégio, não de
disciplina: a role da aplicação perdeu `INSERT`/`UPDATE`/`DELETE` sobre
`estoque_saldo`, e só o trigger `SECURITY DEFINER` a escreve.

| Regra | Onde vale |
| --- | --- |
| Razão **append-only** — estorno é movimento contrário | Sem rota de escrita + trigger `trg_movimento_estoque_imutavel` + `REVOKE UPDATE/DELETE` (`bd/08`) |
| Saldo nunca fica negativo | Trigger `trg_prepara_movimento_estoque` + CHECK `ck_estoque_saldo_quantidade` |
| Entrada exige custo unitário > 0 | Service (RF-034) — sem custo, a média ponderada iria a zero |
| Saída e ajuste positivo saem pelo custo médio corrente | Service + trigger (`bd/08`) |
| Ajuste exige justificativa | Service — ajuste sem motivo é indistinguível de desvio |
| Transferência é atômica e entre locais distintos | Duas pernas na mesma transação + CHECK `ck_movimento_locais_distintos` |
| Um local **padrão** por filial | Service + índice único parcial `ux_local_estoque_padrao` |
| Uma contagem aberta por local | Service + índice único parcial `ux_inventario_local_aberto` |
| Local com saldo não é inativado | Service — inativar esconderia estoque que existe |

O tipo `INVENTARIO` de `enum_tipo_mov_estoque` **não é lançável**: não tem sinal
definido, e aplicá-lo produzia uma linha de delta zero no razão. O ajuste
apurado na contagem entra como `AJUSTE_POSITIVO`/`AJUSTE_NEGATIVO` com
`origin = 'INVENTARIO'` e `originId` = o inventário. Transferências ligam as duas
pernas por um `originId` comum (`origin = 'TRANSFERENCIA'`).

`local_destino_id` é a **contraparte**, não "o destino" em todo caso: na perna de
saída é o local que recebe; na de entrada, o que enviou.

### Inventário: fluxo e barreiras (RF-033)

`ABERTO → EM_CONTAGEM → CONCLUIDO`, com `CANCELADO` disponível até a conclusão.

- a abertura fotografa os saldos do local; `quantidade_sistema` é imutável
  (`bd/08`) — é contra ela que a diferença foi apurada;
- concluir exige `inventories:APPROVE`, todos os itens contados e **não ser o
  responsável pela contagem** (RN-003);
- a conclusão gera os ajustes no razão e vai à trilha como `FECHAMENTO`; o
  cancelamento exige motivo, que também vai à trilha (não há coluna para ele).

`GET /partners/:id/history` (RF-025) consolida `titulo` e `pedido_compra`. Com o
M08 na Sprint 6, o lado financeiro passou a responder com dados reais; o lado de
compras continua zerado até o M06 (Sprint 8).

### M08 — Contas a Pagar e Receber: o que a API não deixa você escrever

Uma entidade só (`/financial-entries`) para as duas carteiras, discriminada por
`type`. Não existe `DELETE`: título emitido é documento, e o que há é
cancelamento com motivo.

| Campo | Quem escreve | Por quê |
| --- | --- | --- |
| `netAmount` | Trigger `trg_prepara_titulo` (`bd/09`) | É `grossAmount - discountAmount`. Dois números para o mesmo fato divergem no primeiro acerto |
| `number` | `fn_proximo_numero_titulo` (`bd/09`) | Sequencial por empresa, **tipo** e ano (`CP-2026-000001`, `CR-2026-000001`), serializado na transação |
| `status`, `balance`, `settledAmount` do título | Projeção das parcelas (`bd/09`) | O título é o retrato das suas parcelas — não um número editável |
| `status`, `balance`, `settledAmount`, juros/multa/desconto da parcela | Projeção das baixas (`bd/09`) | A baixa é a única porta de entrada da liquidação |
| `totalAmount` da baixa | Trigger `trg_prepara_baixa` (`bd/09`) | É `principal + juros + multa - desconto`; calcular no cliente criaria uma segunda fórmula |

### M08 — os dois números que não se confundem

| Coluna | Significado |
| --- | --- |
| `balance` da parcela | **Principal em aberto** — só `principalAmount` da baixa o reduz |
| `settledAmount` da parcela | **Caixa movimentado** — inclui juros e multa cobrados, menos o desconto |

Pagar juros não abate principal, e desconto reduz o caixa sem deixar dívida:
quem quita uma parcela de 400 concedendo 20 informa `principalAmount: "400.00"`
e `discountAmount: "20.00"` — a parcela fecha e saem 380.

### M08 — regras e barreiras

| Regra | Onde vale |
| --- | --- |
| As parcelas somam exatamente o valor líquido | Service + constraint trigger **adiada para o commit** `trg_titulo_parcelas_somam`/`trg_parcela_soma_titulo` (`bd/09`) |
| Todo título tem ao menos uma parcela | Mesma constraint trigger |
| A baixa não passa do principal em aberto | Service + trigger `trg_prepara_baixa`, com advisory lock por parcela |
| Baixa é **append-only** — estorno é lançamento contrário | Sem rota de escrita + `trg_baixa_imutavel` + `REVOKE UPDATE/DELETE` (`bd/09`) |
| Uma baixa é estornada uma vez só | Trigger + índice parcial `ux_baixa_estorno_unico` |
| Título pendente de aprovação não é baixado | Service + trigger `trg_prepara_baixa` (RF-056) |
| Aprovação não volta atrás | Trigger `trg_titulo_aprovacao` |
| Título com baixa viva não é cancelado | Trigger `trg_prepara_titulo` |
| Parcela liquidada não muda de valor nem de vencimento | Trigger `trg_prepara_parcela` |
| O vencimento originalmente combinado nunca é reescrito | Trigger `trg_prepara_parcela` — é o que revela a parcela já prorrogada três vezes |
| Categoria precisa ser da mesma natureza do título | Service (RF-054) |
| Título a pagar exige fornecedor; a receber, cliente | Service, via `ReferencesService` (RF-022/RF-023) |

O parcelamento pode vir de três lugares, nesta ordem: a lista explícita
(`installments`), a condição de pagamento (`paymentTermId`) ou o parcelamento
simples (`installmentCount` + `intervalDays`). Sem nada disso, o título nasce com
uma parcela única. **A condição de pagamento define só o parcelamento** — o
desconto cadastrado nela não é aplicado sozinho: valor que muda sem ninguém
pedir é defeito, não conveniência.

O resto da divisão vai para a **última parcela**: 1.000,00 em três dá 333,33 +
333,33 + 333,34. Sem isso, um centavo evapora e o banco recusa o título no
commit.

### Encargos, carteira e inadimplência (RF-055/RF-058)

Juros ao dia e multa única incidem sobre o saldo **depois** do vencimento, e são
calculados no modelo (`fn_encargos_atraso`, `bd/09`) — não no service. Com
`applyLateCharges: true` na baixa, o valor cobrado é exatamente o que a carteira
mostra; informar `interestAmount`/`penaltyAmount` explicitamente sobrepõe o
cálculo, porque negociar encargo é decisão de quem cobra.

- `GET /installments` — posição da carteira (`vw_parcela_posicao`): dias de
  atraso, encargos, valor atualizado e faixa de aging;
- `GET /delinquency` — inadimplência agregada por faixa e por parceiro. Faixas
  sem parcela aparecem **zeradas**: faixa ausente lê-se como "não consultei".

### Recorrências (RF-053)

`POST /recurrences/:id/generate` gera as ocorrências devidas até uma data — três
meses esquecidos viram três títulos, não um com o valor somado. Não há job
silencioso: cada rodada tem um usuário responsável, que é o que a trilha
registra (RF-115). O limite de 60 títulos por chamada transforma uma recorrência
diária esquecida por anos em várias chamadas conscientes, em vez de um timeout
no meio da criação. A data da próxima ocorrência é calculada pelo banco
(`fn_proxima_ocorrencia`), que é onde "todo dia 31" sabe o que fazer em
fevereiro.

### M14 — Fluxo de Caixa: o que existe e o que é calculado

O fluxo de caixa **não é uma tabela**. `GET /cash-flow/summary` e
`GET /cash-flow/projection` são agregações de `vw_fluxo_caixa` (`bd/10`), que
projeta títulos e baixas do M08. "Quanto entra em novembro" muda a cada baixa
registrada — um número gravado ontem estaria errado hoje sem que ninguém tivesse
errado nada. Só o planejamento tem tabela própria: cenário, projeção digitada e
configuração de alerta.

| Situação | De onde vem | Datado em |
| --- | --- | --- |
| `REALIZADO` | Baixa viva (nem estornada, nem lançamento de estorno) | `data_baixa` — o dia em que o dinheiro andou |
| `VENCIDO` | Parcela em aberto com vencimento no passado | `data_vencimento` |
| `PREVISTO` | Parcela em aberto com vencimento hoje ou à frente | `data_vencimento` |

Título pendente de aprovação (RF-056) fica **fora** da projeção: não pode ser
pago, e planejar caixa com ele é planejar com dinheiro que talvez nunca saia.

| Regra | Onde vale |
| --- | --- |
| Um cenário base por empresa | Índice parcial `ux_cenario_base` + despromoção do anterior na mesma transação |
| Premissa só pode ser `entradas_percentual`/`saidas_percentual`, numérica, entre -100 e 100 | DTO + trigger `trg_valida_premissas_cenario` (`bd/10`) |
| Projeção manual exige cenário, cai dentro da janela dele e é sempre `PREVISTO` | Service + trigger `trg_valida_projecao_manual` |
| Valor da projeção é positivo — a direção vem do tipo | Service + trigger |
| Encurtar a janela do cenário com projeção fora dela é recusado | Service (409) |
| Um alerta ativo por caixa (conta ou empresa) | Índices parciais `ux_alerta_caixa_conta`/`ux_alerta_caixa_empresa` |
| Horizonte do alerta entre 1 e 180 dias | DTO + `ck_alerta_caixa_antecedencia` |

**Projeção e saldo acumulado.** Sem cenário, o saldo parte do caixa de hoje
(`fn_saldo_caixa_atual`) e a janela precisa começar hoje ou depois — somar de
novo o realizado de agosto sobre um saldo que já o contém daria um saldo
projetado errado, e errado para mais. O passado se consulta em
`/cash-flow/summary`. Com cenário, a origem é o saldo inicial **declarado nele**,
e por isso a janela pode começar no passado.

As premissas ajustam apenas o que ainda não aconteceu (previsto e vencido): o
realizado é extrato, não expectativa.

**Alerta (RF-105).** A configuração é gravada; o disparo, não — avaliar é
caminhar o saldo dia a dia dentro do horizonte. A resposta destaca o **primeiro**
dia de ruptura: saber que faltará dinheiro em algum momento dos próximos 60 dias
não muda decisão nenhuma; saber que falta na terça, sim. Enquanto o M09 (Sprint
10) não liga baixa a conta bancária, a conta informada no alerta define só o
saldo de partida — a projeção dos movimentos é da empresa inteira.

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

A gravação usa `createMany`, e não `create`: `create` emite `INSERT ... RETURNING`,
e o `RETURNING` é submetido à política de leitura da trilha
(`empresa_id = fn_empresa_corrente()`). Um evento de plataforma — login e logout
têm `empresa_id` nulo — nunca satisfaz essa condição, e o INSERT era recusado com
`42501`, derrubando a requisição. A trilha é append-only e ninguém precisa da
linha de volta, então não devolvê-la sai mais barato que afrouxar a leitura.

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
  de comprovantes, papéis do parceiro, consistência do catálogo, movimentação e
  transferência de estoque, máquina de estados do inventário, parcelamento,
  liquidação com trava de saldo, estorno, geração de recorrências, saldo
  acumulado da projeção, premissas de cenário e ruptura do alerta de caixa).
- **Financeiro (Sprint 6)**: `titulo_baixa` é append-only nas mesmas três camadas
  da trilha de auditoria — ausência de rota de escrita, trigger que rejeita
  `UPDATE`/`DELETE` e retirada do privilégio da role da aplicação. A marcação de
  estorno é feita por trigger `SECURITY DEFINER`, o único caminho que restou.
  Lançar, aprovar e liquidar são recursos de permissão separados: quem lança a
  despesa não decide sobre ela (RN-003), e quem movimenta caixa não define o que
  é devido. Pagamento, recebimento e estorno vão à trilha como eventos de
  negócio (`PAGAMENTO`/`RECEBIMENTO`/`ESTORNO`).
- **Estoque (Sprint 5)**: `estoque_saldo` é projeção e a role da aplicação não
  tem privilégio de escrita sobre ela; `movimento_estoque` é append-only nas
  mesmas três camadas da trilha de auditoria. Movimentar, valorizar e concluir
  inventário são recursos de permissão separados — quem opera o depósito não
  homologa a diferença nem lê o valor do ativo.
- **Fluxo de caixa (Sprint 7)**: o consolidado é leitura derivada — não há rota
  que escreva movimento de caixa, e o que se grava (cenário, projeção digitada,
  alerta) é auditado por trigger. Ler o fluxo, planejar e configurar alerta são
  recursos separados: quem opera o caixa enxerga o aviso mas não muda o saldo
  mínimo que o dispara, porque afrouxar o próprio alerta é a maneira silenciosa
  de fazer o aviso parar de sair.
- **RN-001 estrutural (Sprints 3 a 7)**: as referências do M03, M04, M05, M08 e M14 usam **FK composta**
  `(empresa_id, <coluna>)`. A verificação de chave estrangeira roda no sistema,
  sem RLS: sem isso, um defeito na API poderia vincular funcionário da empresa A
  ao centro de custo da empresa B. Como FK composta não aceita `ON DELETE SET
  NULL` no PostgreSQL 14, o que era `SET NULL` virou `RESTRICT` — cadastro em
  uso é **inativado**, não removido.
- **Segregação de dados sensíveis**: dado bancário (`employee-bank-accounts` e
  `partner-bank-accounts`), remuneração (`compensation`), folha (`payroll`) e
  histórico do parceiro (`partner-history`) são recursos com permissão própria —
  quem mantém o cadastro não recebe nenhum deles por tabela.
  `GET /payroll/summary` é registrado na trilha como `EXPORTACAO`.
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
