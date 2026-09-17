# SGE
Sistema de Gestão Empresarial e Financeira

Monorepo baseado na ERS v1.0 (`docs/`). Stack de referência: NestJS + TypeScript +
PostgreSQL + Prisma (backend) e Angular 21 + PrimeNG (frontend).

O planejamento tem **32 sprints**: as **Sprints 1 a 17** entregam o backend módulo
a módulo (RF-001 a RF-131, M01 a M18) e as **Sprints 18 a 32** entregam a interface
web (Fase 9, Sprints 18 a 29, e Fase 10, Sprints 30 a 32 — itens `UI-001` a
`UI-093` na planilha).

**Estado: backend e interface concluídos na Sprint 32** — o ciclo terminou com
testes E2E dos fluxos críticos, testes de isolamento multiempresa na interface,
captura de erros do cliente com correlation id, esteira de build/testes/publicação,
manual do usuário com ajuda contextual e roteiro de homologação assistida (UAT)
com a lista de verificação de go-live. A API continua documentada em `/api/docs`.

## Estrutura

- [`bd/`](bd) — **modelo físico PostgreSQL** (schema `gestao`), fonte da verdade
  do banco: M01 a M18, RLS multiempresa, triggers de auditoria e regras de negócio.
- [`backend/`](backend/README.md) — API REST (NestJS). Sprints 1 a 17 implementadas
  (RF-001 a RF-131).
- [`frontend-ng/`](frontend-ng/README.md) — interface web (Angular 21 + PrimeNG).
  Sprints 18 a 32 implementadas (UI-001 a UI-093), com 55 arquivos de teste
  (Vitest + TestBed), auditoria de interface própria e imagem Docker/nginx.
- `docs/` — ERS, planejamento de sprints, [manual do usuário](docs/manual-do-usuario.md),
  [homologação e go-live](docs/homologacao-uat.md) e
  [auditoria de acessibilidade](docs/auditoria-ui-086.md).
- `.github/workflows/frontend.yml` — esteira da interface (UI-091): tipos,
  auditoria de interface, testes e build, em série. A conferência de formatação
  está no arquivo, porém comentada — ligá-la depende de reformatar o
  repositório de uma vez.

## Telas Figma

- **[SGE — Telas do sistema](https://www.figma.com/design/2fHfjDKNSzL2QJiM8jPkI5)** — as 74 telas
  do sistema numa única página (`SGE — Todas as telas`), em 16 faixas por módulo, a 1440×900 e
  com a paleta do tema. Cada frame leva o código `UI-xxx` da planilha. Desde a Sprint 18 as
  telas estão no tema escuro do preset `sge-preset.ts` (primária violeta, superfície carvão
  azulado), e o arquivo traz a coleção de variáveis `SGE · Tokens (PrimeNG)` com os modos
  Claro e Escuro.
- [ERP — Telas](https://www.figma.com/design/PA06FnojAoWND0fa0uVeve/ERP-%E2%80%94-Telas?node-id=0-1)
  — arquivo original com os rascunhos da Sprint 18.

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
| `12_documentos_fiscais_sprint9.sql` | M07: consistência dos itens e dos totais da nota, duplicidade, máquina de estados do processamento, imutabilidade do XML e vínculo com estoque/financeiro sem duplicidade | `gestao_owner` |
| `13_bancos_sprint10.sql` | M09: conta bancária, máquina de estados da ordem de pagamento, idempotência imutável, uma baixa por transação, webhook deduplicado, fila com retry e RLS estrita | `gestao_owner` |
| `14_conciliacao_sprint11.sql` | M10: FKs multiempresa da conciliação, regra com prioridade e tolerâncias, soma limitada pelo movimento, status derivado e histórico append-only | `gestao_owner` |
| `15_ocr_sprint12.sql` | M13: um processamento por documento, domínio dos campos lidos, máquina de estados da leitura, validação humana registrada e resultado preservado | `gestao_owner` |
| `16_notificacoes_sprint13.sql` | M15: notificação deduplicada por fato, caixa de entrada por usuário, fila de entrega e regras de automação com trilha de execuções | `gestao_owner` |
| `17_contabilidade_sprint14.sql` | M11: plano de contas hierárquico, partida dobrada balanceada e imutável, razão, balancete, DRE, fechamento em duas etapas e exportação | `gestao_owner` |
| `18_fiscal_sprint15.sql` | M12: parâmetros fiscais com vigência, classificações (NCM/CEST/CFOP/CST/LC116), regras por operação com prioridade, eventos fiscais imutáveis e apuração por competência | `gestao_owner` |
| `19_relatorios_sprint16.sql` | M17: bases dos dashboards e relatórios (carteira, aging, realizado, compras, estoque, pessoal) e auditoria da exportação | `gestao_owner` |
| `20_integracoes_sprint17.sql` | M18: integrações por empresa, credenciais e parâmetros sem segredo em claro, saúde da integração, eventos append-only e reprocessamento | `gestao_owner` |
| `98_smoke_bancos_sprint10.sql` | Confere as regras de `13` num banco já migrado; termina em `ROLLBACK` | `gestao_owner` |
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
psql -U gestao_owner -h localhost -d gestao_empresarial -f 12_documentos_fiscais_sprint9.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 13_bancos_sprint10.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 14_conciliacao_sprint11.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 15_ocr_sprint12.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 16_notificacoes_sprint13.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 17_contabilidade_sprint14.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 18_fiscal_sprint15.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 19_relatorios_sprint16.sql
psql -U gestao_owner -h localhost -d gestao_empresarial -f 20_integracoes_sprint17.sql
```

No Windows, `bd/instalar-bd.ps1` executa toda a sequência acima — inclusive o
drop. Ele pede confirmação (digitar o nome do banco) quando o banco já existe;
`-Forcar` pula a pergunta.

Para levar um banco **já existente** até a sprint atual **sem perder os dados**,
use o modo de atualização: ele não apaga nada, não pede a senha do superusuário
e reaplica só os scripts de ajuste (`04` a `20`), que são idempotentes.

```bash
pwsh bd/instalar-bd.ps1 -Atualizar
```

Depois, em `backend/`: `npm run db:seed` (permissões novas) e `npm run db:check`.

> ⚠️ `00_setup_banco.sql` **apaga** o banco `gestao_empresarial` e as roles
> `app_gestao`/`sge_api` antes de recriar. Os scripts `01` a `03` montam o schema
> do zero — não são migrações e não se aplicam sobre um banco já existente. Os
> scripts `04` a `20` são ajustes idempotentes: esses, sim, podem ser reaplicados
> sobre um banco com dados (é o que faz `instalar-bd.ps1 -Atualizar`).

Não rode os scripts como superusuário: superusuário ignora RLS e o isolamento
multiempresa deixaria de ser exercitado.

## Backend — Sprints 1 a 17

### Fase 1 — Fundação

**Sprint 1** — Cadastro de empresas/filiais/configurações (M01) e
usuários/perfis/permissões (M02), com autenticação, RBAC, isolamento
multiempresa (RLS no banco) e alçadas (RF-001 a RF-012).

**Sprint 2** — Auditoria (M16): trilha de eventos registrando autor, data/hora,
origem e entidade, com valores anterior e posterior, consulta filtrada por
período/evento/entidade e proteção do registro contra alteração
(RF-114 a RF-118).

### Fase 2 — Cadastros

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

### Fase 3 — Financeiro

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

### Fase 4 — Compras e Documentos

**Sprint 8** — Compras (M06): pedidos de compra com itens, quantidades, preços,
descontos e frete rateado, submissão a aprovação por alçada, recebimento total
ou parcial com conferência de quantidade e preço, vínculo do pedido com
fornecedor, estoque e financeiro, e histórico de compras e de preços
(RF-036 a RF-042).

**Sprint 9** — Documentos Fiscais (M07): importação de XML de NF-e/NFC-e com
conferência da chave de acesso, armazenamento do original e dos metadados,
processamento de emitente, destinatário, itens, valores e tributos, detecção de
duplicidade, vínculo com fornecedor, pedido, produtos, estoque e contas, anexo de
DANFE/PDF, controle de erros e reprocessamento, e coleta automática por
integração externa (RF-043 a RF-050).

### Fase 5 — Bancos, conciliação e automação

**Sprint 10** — Bancos, Pagamentos e Recebimentos (M09): contas bancárias da
empresa, provedores atrás de uma porta única com credenciais cifradas, ordens
PIX, boleto, TED e transferência com agendamento, envio e consulta por fila com
retry controlado, webhooks idempotentes com assinatura conferida e importação de
extratos OFX/CSV (RF-059 a RF-070).

**Sprint 11** — Conciliação Bancária (M10): importação de extrato OFX, CSV e
CNAB 240, identificação do movimento, sugestão de correspondência com título,
baixa e ordem, conciliação manual e automática por regras, painel de divergências
e histórico append-only (RF-071 a RF-077).

**Sprint 12** — OCR e Automação de Documentos (M13): recepção de imagens e PDFs,
leitura na fila atrás de uma porta de provedor (com adaptador manual para quem
não contratou OCR), extração de valor, data, estabelecimento, chave e número do
documento, sugestão de parceiro, categoria e centro de custo pelo histórico, e
validação humana registrada (RF-095 a RF-100).

**Sprint 13** — Notificações e Alertas (M15): notificação interna deduplicada por
fato, entrega por e-mail atrás de porta/adaptador, alertas de vencimento,
pagamento, aprovação pendente e divergência de conciliação, e regras de automação
com gatilho, condições, canal e trilha de execuções (RF-119 a RF-125).

### Fase 6 — Contábil e fiscal

**Sprint 14** — Contabilidade (M11): plano de contas hierárquico, classificação
contábil de categorias, verbas e contas bancárias, lançamento de débito e crédito
balanceado e imutável (corrigido por estorno), razão, balancete, DRE, fechamento
em duas etapas com reabertura justificada e exportação no grão da partida
(RF-078 a RF-087).

**Sprint 15** — Fiscal (M12): parâmetros fiscais por empresa/filial com vigência
sem sobreposição, classificações fiscais conferidas, leitura da tributação
declarada com apontamento de divergências, regras fiscais resolvidas por
prioridade e especificidade, eventos fiscais imutáveis e apuração com livro de
entradas e saídas (RF-088 a RF-094).

### Fase 7 — Dashboards, relatórios e integrações

**Sprint 16** — Dashboards e Relatórios (M17): painel financeiro, carteira por
vencimento com aging, fluxo realizado e DRE do período, indicadores de compras,
fornecedores e estoque, quadro de pessoal e centros de custo, relatórios contábil
e fiscal, filtros combinados e exportação auditada em PDF, XLSX e CSV
(RF-106 a RF-113).

**Sprint 17** — Integrações e API (M18): administração de integrações por
empresa, credenciais e parâmetros que recusam segredo em claro, monitoramento com
suspensão automática por falhas consecutivas, registro append-only de erros com
redação de segredos, reprocessamento idempotente e documentação OpenAPI
(RF-126 a RF-131).

## Fases 9 e 10 — Interface Web (Sprints 18 a 32)

O frontend (Angular 21 + PrimeNG) não tem requisito próprio na ERS: são as telas
dos RF já entregues pelo backend, planejadas como itens `UI-001` a `UI-093`. As
Sprints 18 a 29 formam a **Fase 9 — Interface Web** (as telas módulo a módulo) e
as Sprints 30 a 32, a **Fase 10 — Qualidade e Entrega da Interface**.

| Sprint | Itens | Entrega |
| --- | --- | --- |
| 18 | UI-001 a UI-006 | Fundação: projeto, autenticação, empresa ativa, RBAC na interface e componentes base |
| 19 | UI-007 a UI-012 | Administração: empresas, filiais, usuários, perfis, alçadas e auditoria (M01/M02/M16) |
| 20 | UI-013 a UI-017 | RH: funcionários, cargos, histórico funcional, verbas e reembolsos (M03) |
| 21 | UI-018 a UI-023 | Parceiros, catálogo, locais de estoque, movimentações e inventário (M04/M05) |
| 22 | UI-024 a UI-029 | Financeiro: títulos, aprovação, baixas, inadimplência, fluxo de caixa e cenários (M08/M14) |
| 23 | UI-030 a UI-035 | Compras: pedido, alçada, recebimento, divergências e histórico de preços (M06) |
| 24 | UI-036 a UI-041 | Documentos fiscais: importação de XML, duplicidade, vínculos, anexos e coleta (M07) |
| 25 | UI-042 a UI-047 | Bancário: contas, ordens com `Idempotency-Key`, agendamento, extratos e fila (M09) |
| 26 | UI-048 a UI-053 | Conciliação: importação, sugestões com score, regras, divergências e histórico (M10) |
| 27 | UI-054 a UI-060 | Contábil: plano de contas, lançamentos, razão, balancete, DRE, fechamento e exportação (M11) |
| 28 | UI-061 a UI-067 | Fiscal: parâmetros, regras com simulação, eventos e apuração com livro (M12) + notificações, preferências de alerta e regras de automação (M17) |
| 29 | UI-068 a UI-075 | Dashboards, indicadores, filtros combinados e relatórios exportáveis (M15) + administração e monitoramento de integrações (M18) |
| 30 | UI-076 a UI-081 | Design system vivo, busca global, preferências, onboarding, impressão/exportação e estados padronizados |
| 31 | UI-082 a UI-086 | Acessibilidade WCAG 2.1 AA, responsividade, formatos pt-BR, cache e virtualização, auditoria de interface |
| 32 | UI-087 a UI-093 | Testes E2E dos fluxos críticos, isolamento multiempresa na interface, observabilidade com correlation id, esteira de CI, manual e ajuda contextual, homologação assistida e go-live |

## Qualidade e entrega

- **Testes** — Vitest + Angular TestBed em `frontend-ng` (55 arquivos de teste,
  incluindo os E2E de login, fluxos financeiros e isolamento multiempresa).
- **Esteira** — `.github/workflows/frontend.yml` roda tipos, auditoria de
  interface, testes e build em série, monta a imagem Docker e guarda o bundle
  como artefato. A publicação em produção continua sendo decisão de quem opera.
- **Acessibilidade e responsividade** — `npm run auditoria:ui` em `frontend-ng`
  aplica as regras descritas em [docs/auditoria-ui-086.md](docs/auditoria-ui-086.md);
  a execução final fecha com 0 achados.
- **Homologação** — cenários, apontamentos corrigidos e checklist de go-live em
  [docs/homologacao-uat.md](docs/homologacao-uat.md).
- **Uso** — [docs/manual-do-usuario.md](docs/manual-do-usuario.md); a mesma ajuda
  aparece por módulo no botão `?` da barra superior.

Ver [backend/README.md](backend/README.md) para instruções de execução, o mapa
requisito → endpoint e o contrato da API, e
[frontend-ng/README.md](frontend-ng/README.md) para o tema, o preset e os
comandos da interface.
