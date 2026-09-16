# Homologação assistida (UAT) e go-live — UI-093

Roteiro de homologação da interface, registro dos apontamentos encontrados na
Sprint 32 e a lista de verificação de entrada em produção.

A homologação aqui descrita é **assistida**: cada cenário tem um responsável do
negócio que executa e um do time que acompanha, com o critério de aceite escrito
antes da execução. Cenário sem critério escrito vira discussão, não decisão.

---

## 1. Preparação do ambiente

| Item | Como conferir |
| --- | --- |
| Banco com RLS ativa | `bd/99_smoke_test.sql` executa sem erro |
| Backend no ar | `GET /api/v1/health` responde 200 |
| Interface publicada | `docker build` de `frontend-ng/Dockerfile` e container no ar |
| Cabeçalhos de segurança | resposta de `/` traz `Content-Security-Policy`, `X-Frame-Options`, `Referrer-Policy` |
| Duas empresas cadastradas | obrigatório: sem a segunda, o cenário de isolamento não existe |
| Três usuários | um administrador, um operador financeiro, um aprovador |

> **Regra dos dados**: homologação usa massa de teste. Nenhum cenário abaixo
> pode ser executado contra dados financeiros reais.

---

## 2. Cenários

Cada linha é um cenário de UAT. `Automatizado` indica que a mesma garantia já é
verificada na esteira — o teste automatizado não substitui a execução assistida,
mas cobre a regressão entre uma homologação e outra.

### 2.1 Acesso e sessão

| # | Cenário | Critério de aceite | Automatizado |
| --- | --- | --- | --- |
| A1 | Abrir uma URL interna sem sessão | vai ao login e, após entrar, volta à URL pedida | sim (`e2e/login-flow`) |
| A2 | Entrar com senha errada | mensagem clara, sem revelar se o e-mail existe | — |
| A3 | Entrar com vínculo único | entra direto, sem passar pela seleção de empresa | sim (`e2e/login-flow`) |
| A4 | Entrar com dois vínculos | para na seleção de empresa | sim (`e2e/isolamento`) |
| A5 | Deixar a tela parada 30 min | sessão cai e o login explica a inatividade | sim (`core/security`) |
| A6 | Trabalhar perto da expiração | token renova sozinho, sem interromper o trabalho | sim (`core/security`) |
| A7 | Sair do sistema | empresa ativa e refresh token são descartados | sim (`e2e/isolamento`) |

### 2.2 Isolamento multiempresa

| # | Cenário | Critério de aceite | Automatizado |
| --- | --- | --- | --- |
| B1 | Trocar de empresa e navegar | toda requisição leva o `x-company-id` da empresa nova | sim (`e2e/isolamento`) |
| B2 | Trocar de empresa numa tela com selects | listas de referência são recarregadas, não reaproveitadas | sim (`e2e/isolamento`) |
| B3 | Perfis diferentes por empresa | módulo liberado em uma e bloqueado na outra se comporta assim | sim (`e2e/isolamento`) |
| B4 | Editar `localStorage` com outra empresa e recarregar | escolha descartada; o vínculo válido volta a valer | sim (`e2e/isolamento`) |
| B5 | Abrir por URL um registro da outra empresa | tela não carrega dado nenhum (403/404 do servidor) | — (exige backend) |

### 2.3 Financeiro — lançamento, aprovação e baixa

| # | Cenário | Critério de aceite | Automatizado |
| --- | --- | --- | --- |
| C1 | Lançar título parcelado | parcelas somam o líquido; valores viajam como texto decimal | sim (`financeiro-pages`) |
| C2 | Lançar acima da alçada | exige aprovação; baixa bloqueada até a decisão | sim (`financeiro-pages`) |
| C3 | Tentar aprovar o próprio lançamento | recusado | sim (`financeiro-pages`) |
| C4 | Baixar parcela vencida | encargos calculados pelo servidor, não pela tela | sim (`e2e/fluxos-financeiros`) |
| C5 | Clicar duas vezes em "Registrar baixa" | uma baixa só | sim (`financeiro-pages`) |
| C6 | Perder a rede no meio da baixa e repetir | mesma chave, sem baixa duplicada | sim (`financeiro-pages`) |
| C7 | Estornar baixa sem motivo | recusado | sim (`financeiro-pages`) |

### 2.4 Bancos — ordem de pagamento

| # | Cenário | Critério de aceite | Automatizado |
| --- | --- | --- | --- |
| D1 | Emitir PIX | confirmação com resumo antes do envio; chave de idempotência na requisição | sim (`e2e/fluxos-financeiros`) |
| D2 | Emitir com conta não habilitada a pagar | recusado na tela, antes de sair | sim (`bancos-pages`) |
| D3 | Agendar para data passada | recusado | sim (`bancos-pages`) |
| D4 | Usuário sem `payments:CREATE` abre a tela de emissão | mandado para "sem permissão" | sim (`e2e/fluxos-financeiros`) |
| D5 | Acompanhar ordem com falha no provedor | tentativas visíveis; nenhuma duplica a ordem | — (exige provedor) |

### 2.5 Conciliação

| # | Cenário | Critério de aceite | Automatizado |
| --- | --- | --- | --- |
| E1 | Conciliar pela sugestão de maior score | vínculo criado com o valor do movimento | sim (`e2e/fluxos-financeiros`) |
| E2 | Conciliar com valor diferente | exige justificativa | sim (`conciliacao-pages`) |
| E3 | Desfazer conciliação | exige motivo e fica registrado | sim (`conciliacao-pages`) |
| E4 | Marcar movimento como sem par | exige motivo; bloqueado se já houver vínculo vivo | sim (`conciliacao-pages`) |

### 2.6 Interface, acessibilidade e saída de dados

| # | Cenário | Critério de aceite | Automatizado |
| --- | --- | --- | --- |
| F1 | Navegar uma tela inteira só pelo teclado | ordem de foco previsível; "pular para o conteúdo" funciona | parcial (`core/a11y`) |
| F2 | Usar em tablet e celular | sem rolagem horizontal; gaveta de menu funcional | parcial (`auditoria:ui`) |
| F3 | Exportar CSV com nome de parceiro começando em `=` | planilha abre o valor como texto, não como fórmula | sim (`core/security`) |
| F4 | Imprimir uma listagem | sai sem menu e sem barra superior | — |
| F5 | Abrir a ajuda em cada módulo | conteúdo é do módulo aberto | sim (`core/help`) |
| F6 | Forçar um erro 500 | alerta mostra o **código da ocorrência** | sim (`core/observability`) |

---

## 3. Apontamentos da homologação — Sprint 32

Quatro defeitos reais encontrados ao escrever e executar os cenários acima.
Todos corrigidos nesta sprint.

| # | Apontamento | Efeito | Situação |
| --- | --- | --- | --- |
| P1 | Depois do login, a guarda de rota decidia antes do efeito que escolhe a empresa | usuário com **um único vínculo** caía em "selecionar empresa", com uma empresa na lista | corrigido em `core/company/company.service.ts` (`resolverSelecao`, chamada também por `prontidao()`) |
| P2 | O CSV exportado da listagem não neutralizava fórmula | nome de parceiro começando em `=`, `+`, `-` ou `@` era executado pela planilha ao abrir o arquivo (CSV injection). O exportador do **backend** já neutralizava; o da tela, não | corrigido em `core/lib/csv.ts` + `core/security/sanitize.ts` |
| P3 | `x-company-id` saía do armazenamento bruto, que podia divergir da empresa validada pelo serviço | cabeçalho com id que o serviço havia recusado | corrigido: a escolha válida é reescrita sobre o armazenamento em `resolverSelecao` |
| P4 | `admin-pages.spec.ts` navegava para uma rota inexistente no mapa do teste | rejeição não tratada: **suíte inteira passando e o processo saindo com código 1** — a esteira da UI-091 nasceria vermelha | corrigido: rota curinga no `provideRouter` do teste |

### Fora do escopo (registrado, não corrigido)

| # | Observação | Por que não foi corrigido agora |
| --- | --- | --- |
| Q1 | 174 arquivos anteriores a esta sprint divergem da configuração do Prettier | reformatar o repositório é decisão do líder do projeto; o passo de formatação está na esteira, comentado, pronto para ser ligado depois do reformata-tudo |
| Q2 | Cenários B5 e D5 dependem de backend e provedor no ar | não são automatizáveis na esteira da interface; ficam como execução assistida |

---

## 4. Lista de verificação de go-live

### Antes

- [ ] Esteira verde no commit que vai ao ar (tipos, auditoria de interface, testes, build).
- [ ] `docs/manual-do-usuario.md` entregue aos usuários.
- [ ] Todos os cenários da seção 2 executados e assinados pelo responsável do negócio.
- [ ] Apontamentos bloqueantes: nenhum em aberto.
- [ ] Massa de teste **removida** do ambiente que vai a produção.
- [ ] Empresas, filiais, perfis de acesso e alçadas cadastrados de verdade.
- [ ] Contas bancárias conferidas — agência, conta e habilitação de pagar/receber.
- [ ] Variáveis de ambiente do gateway conferidas: `CORS_ORIGINS`, TLS ativo.
- [ ] Cabeçalhos de segurança respondendo no domínio de produção.
- [ ] Rotina de backup do banco testada com uma restauração de verdade.

### No dia

- [ ] Publicar a imagem da interface e conferir a versão servida.
- [ ] Entrar com um usuário de cada perfil e percorrer o caminho principal.
- [ ] Emitir **uma** ordem de pagamento de valor baixo e conferir o retorno do banco.
- [ ] Conferir a trilha de auditoria das ações do dia.

### Depois

- [ ] Acompanhar as ocorrências do cliente (UI-090) na primeira semana.
- [ ] Conferir no log do servidor, por correlation id, todo erro relatado.
- [ ] Reunião de fechamento com os apontamentos da primeira semana.

---

## 5. Como registrar um apontamento

1. O que você fez, passo a passo.
2. O que esperava que acontecesse.
3. O que aconteceu.
4. Empresa, usuário e horário.
5. **Código da ocorrência**, quando a tela mostrar um.

Sem os cinco itens, o apontamento não é reproduzível — e apontamento não
reproduzível não vira correção.
