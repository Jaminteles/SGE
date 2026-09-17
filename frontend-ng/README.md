# SGE — Interface Web (Angular)

Interface do Sistema de Gestão Empresarial e Financeira em **Angular 21 + PrimeNG**.

> **Estado: Sprints 18 a 32 concluídas** — os itens `UI-001` a `UI-093` da
> planilha, com 55 arquivos de teste (Vitest + Angular TestBed, incluindo os E2E
> de login, fluxos financeiros e isolamento multiempresa). A fundação anterior
> em React foi removida no commit seguinte ao `483e777`; para consultá-la,
> `git show 483e777:frontend/`.

As Sprints 18 a 29 formam a **Fase 9 — Interface Web** (a fundação e as telas
módulo a módulo) e as Sprints 30 a 32, a **Fase 10 — Qualidade e Entrega da
Interface** (design system, acessibilidade, performance, testes e go-live).

## Executar

```bash
npm install
npm start      # http://localhost:4200
```

| Comando | O que faz |
| --- | --- |
| `npm start` | Servidor de desenvolvimento |
| `npm run build` | Build em `dist/` (`build:prod` para a configuração de produção) |
| `npm test` | Testes (Vitest — runner padrão do Angular 21); `test:ci` roda sem watch |
| `npm run lint` | Prettier em modo verificação; `format` reescreve |
| `npm run typecheck` | `tsc --noEmit` sobre a aplicação e os testes |
| `npm run auditoria:ui` | Auditoria de acessibilidade e responsividade (UI-086) |

A imagem de produção sai do [`Dockerfile`](Dockerfile) em duas etapas: o Node
compila, o nginx publica. A imagem final não leva `node_modules` nem
código-fonte, roda sem root e escuta em 8080. Os cabeçalhos de segurança
(CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`, HSTS) estão em [`nginx.conf`](nginx.conf) — UI-089.

## Stack

| Camada | O que é |
| --- | --- |
| Framework | **Angular 21** (standalone components, signals, sem `NgModule`) |
| Componentes | **PrimeNG 21** + `@primeuix/themes` 3 + `primeicons` |
| Estilo | SCSS sobre os design tokens do PrimeNG |
| Testes | **Vitest** + Angular TestBed |

**Por que Angular 21 e não 22:** o CLI do Angular 22 exige Node `>= 24.15`, e o
ambiente atual tem **Node 24.12**. Atualizar o Node destrava a 22 — a migração
é `ng update`, e o PrimeNG 22 já está publicado.

## Tema

Toda a cor vem de um preset em [`src/app/theme/sge-preset.ts`](src/app/theme/sge-preset.ts),
derivado do Aura. Duas decisões, ambas por causa do domínio:

**Primária violeta (iris), não verde nem azul.** O Aura vem com `emerald` como
primária. Num sistema financeiro, verde já significa "entrou dinheiro" — usar a
mesma cor para "botão principal" e para "crédito" atrapalha a leitura de
qualquer tabela de lançamento. Violeta deixa `emerald`, `amber` e `rose` livres
para o significado financeiro.

**Superfície de carvão azulado, não zinco.** O Aura usa `slate` no claro e
`zinc` no escuro. O zinco puro deixa telas grandes de tabela com cara de cinza
morto; um azulado leve dá profundidade sem voltar ao azul da paleta anterior.

### Como claro/escuro funcionam

A versão 3 do `@primeuix/themes` resolve os dois temas com a função CSS
`light-dark()` — o primeiro valor vale no claro, o segundo no escuro. **Não
existe mais** o bloco `colorScheme: { light, dark }` das versões antigas.

O que liga os dois lados é a propriedade `color-scheme`, definida em
[`src/styles.scss`](src/styles.scss). Sem ela o preset renderiza claro mesmo com
a classe presente.

| Onde | O quê |
| --- | --- |
| `index.html` | `<html lang="pt-BR" class="sge-dark">` — o app nasce escuro, sem piscar branco |
| `app.config.ts` | `darkModeSelector: '.sge-dark'` |
| `styles.scss` | `.sge-dark { color-scheme: dark }` |

Os dois temas já foram verificados: alternar a classe `sge-dark` no `<html>`
troca a interface inteira, incluindo os tons semânticos dos KPIs (que usam o
tom 600 no claro e o 400 no escuro, senão somem sobre branco).

### Botão de tema

Funcional, em [`src/app/theme/theme-service.ts`](src/app/theme/theme-service.ts).
O escuro é o padrão; uma escolha explícita vence o padrão e sobrevive ao reload
(`localStorage`, chave `sge.tema`).

O serviço tem **um único ponto de escrita**: um `effect` sobre o sinal do tema
reflete no `<html>` e persiste. Assim não há como a classe e o estado
divergirem — nem quando a preferência vem do storage no boot.

O acesso ao `localStorage` é protegido por `try/catch` (janela anônima ou
cookies bloqueados fazem o acessor lançar), o mesmo idioma dos stores portados.

## O núcleo portado (`src/app/core/`)

Código sem dependência de framework, copiado do projeto React com alteração
mínima. Os testes vieram junto e passam sem adaptação.

| Arquivo | O que é |
| --- | --- |
| `api/errors.ts` | `ApiError` / `NetworkError` a partir do envelope do backend |
| `api/types.ts` | Contratos da API |
| `lib/decimal.ts` | **RN-012** — dinheiro como string, sem passar por `number` |
| `lib/format.ts` | Data, CNPJ e iniciais em pt-BR |
| `lib/config.ts` | Agora lê de `src/environments/` |
| `authz/permissions.ts` | Avaliação de `recurso:AÇÃO` |
| `auth/session-store.ts` | Access token em memória, refresh em `sessionStorage` |
| `company/active-company-store.ts` | Empresa ativa (RF-005) |

Só **`config.ts`** precisou mudar: trocou `import.meta.env` do Vite por
`environments/`, com `fileReplacements` para produção no `angular.json`.

O proxy de desenvolvimento (`/api` → `localhost:3000`) foi replicado em
[`proxy.conf.json`](proxy.conf.json), equivalente ao que o Vite fazia.

## Camada HTTP ([`api/interceptors.ts`](src/app/core/api/interceptors.ts))

O cliente HTTP escrito à mão do projeto React foi **substituído** por
interceptors sobre o `HttpClient`. A ordem em `withInterceptors` importa — o
primeiro da lista é o mais externo:

```
baseUrl → correlação → cache → erro → empresa → auth → backend
```

O de auth fica mais interno de propósito: a repetição depois da renovação
precisa acontecer **antes** da tradução de erro, senão a segunda tentativa
nunca teria chance de dar certo.

| Interceptor | O que faz |
| --- | --- |
| `baseUrlInterceptor` | Prefixa `/api/v1`, para os services escreverem `'auth/me'` |
| `correlationInterceptor` | `x-correlation-id` por requisição, o mesmo id que o backend carrega no log e na trilha (RNF-010 — UI-090) |
| `queryCacheInterceptor` | Cache curto de `GET` de referência, por empresa, invalidado na mutação (RNF-008 — UI-085) |
| `errorInterceptor` | Envelope do backend → `ApiError`; status 0 → `NetworkError` |
| `companyInterceptor` | `x-company-id` da empresa ativa (RF-005) |
| `authInterceptor` | `Bearer`, e no 401 renova e repete **uma vez** |

O de correlação fica **antes** do de erro de propósito: assim o que sobe já é o
`ApiError` exibível e leva o id da requisição que falhou — mais para dentro, só
passaria o `HttpErrorResponse` cru e o id se perderia na tradução. O de cache
vem logo depois do de base porque precisa da URL final como chave, e antes dos
outros porque resposta servida da memória não tem por que atravessar token,
empresa e tempo limite de novo.

Rotas fora da regra declaram por `HttpContext` (`semAuth()`, `semEmpresa()`,
`rotaPublica()`), no lugar das flags `auth` e `withCompany` de antes. O padrão
é o seguro: sem declaração, a requisição leva token e empresa.

### A renovação única

[`TokenRefreshService`](src/app/core/api/token-refresh.service.ts) garante uma
só chamada a `/auth/refresh` mesmo quando várias requisições tomam 401 ao mesmo
tempo — o caso comum de uma tela que dispara quatro consultas de uma vez. Sem
isso, com refresh token rotativo, as chamadas tardias falhariam e derrubariam a
sessão de um usuário perfeitamente logado.

O serviço usa um `HttpClient` ligado direto ao `HttpBackend`: a renovação **não**
passa pelos interceptors, senão um 401 do próprio `/auth/refresh` dispararia
outra renovação, em laço.

> O teste dessa regra foi verificado por mutação: trocando o `??=` por `=` em
> `garantirRenovacao`, ele falha com *expected 3 to be 1*. O teste tem dentes.

## Sessão e empresa ativa

Os providers do React viraram services com signals, em **três camadas** para a
dependência andar numa direção só:

| Camada | Service | Responsabilidade |
| --- | --- | --- |
| Baixa | `SessionService` | Tokens e sinal de expiração |
| Baixa | `TokenRefreshService` | Renovação única |
| Alta | [`AuthService`](src/app/core/auth/auth.service.ts) | Perfil, login, logout, restauração |
| Alta | [`CompanyService`](src/app/core/company/company.service.ts) | Empresa ativa e permissões |

A separação não é estética: se o perfil e o login morassem no `SessionService`,
fecharia o ciclo `TokenRefreshService → SessionService → AuthApiService →
interceptor → TokenRefreshService`.

A ponte que o `setSessionExpiredHandler` fazia com um callback global agora é um
`effect` sobre o sinal `expirada` do `SessionService`.

O `CompanyService` mantém as regras do provider original: seleção automática
quando há vínculo único ou padrão, descarte de id inválido, e vínculo com
empresa inativa fora da lista.

> A validade da empresa é checada em **dois** lugares de propósito: o `effect`
> limpa a escolha inválida, e o `computed` de `ativaId` nunca a expõe. O efeito
> só roda na detecção de mudanças seguinte — na janela entre o construtor ler o
> `localStorage` e isso acontecer, quem segura é o `computed`.

## RBAC na interface (UI-004)

> **Isto não é controle de acesso.** Serve para não oferecer ao usuário um botão
> que a API vai recusar. Quem autoriza é o `PermissionsGuard` do backend somado
> à RLS, a cada requisição — esconder um item de menu não protege nada.

[`PermissionsService`](src/app/core/authz/permissions.service.ts) expõe as
permissões da empresa ativa como signal, com `pode(codigo)` e
`permite({ all, any })`. O super admin passa em tudo, como no guard do backend.

[`CanDirective`](src/app/core/authz/can.directive.ts) substitui o componente
`<Can>` do React e aceita as três formas:

```html
<button *sgeCan="'partners:CREATE'">Novo parceiro</button>
<span   *sgeCan="['company:READ', 'partners:READ']">exige as duas</span>
<span   *sgeCan="{ any: ['stock:READ', 'inventories:READ'] }">basta uma</span>

<div *sgeCan="'audit:READ'; else semAcesso">…</div>
<ng-template #semAcesso>Sem permissão no perfil</ng-template>
```

A diretiva guarda o que está exibindo e só recria a view quando o estado muda —
sem isso, cada reavaliação destruiria e recriaria o conteúdo, perdendo estado de
formulário e foco.

[`core/navigation.ts`](src/app/core/navigation.ts) traz a navegação por módulo
com a exigência de cada item. A barra lateral e as rotas de módulo saem daí — é
a mesma lista, então menu e permissão de rota não têm como divergir.

### Instanciação no bootstrap

A auto-seleção da empresa ativa mora no construtor do `CompanyService`, e
services `providedIn: 'root'` só existem quando alguém os injeta. Para não
depender de algum componente lembrar disso, o `app.config.ts` o instancia num
`provideAppInitializer`.

## Rotas e guardas

Os componentes-guarda do React viraram `CanActivateFn` em
[`core/auth/guards.ts`](src/app/core/auth/guards.ts):

| Guarda | Exige | Redireciona para |
| --- | --- | --- |
| `apenasAnonimoGuard` | Não estar logado | `/` |
| `sessaoGuard` | Sessão (sem empresa) | `/login?origem=…` |
| `areaAutenticadaGuard` | Sessão **e** empresa ativa | `/login` ou `/selecionar-empresa` |
| `permissaoGuard` | `data.permissions` da rota | `/sem-permissao` |

Todas esperam `auth.prontidao()` antes de decidir. Sem isso, um F5 numa rota
interna avaliaria o estado ainda em branco e jogaria para o login um usuário
cuja sessão seria restaurada meio segundo depois.

A restauração fica **fora** do `provideAppInitializer` de propósito: bloquear o
bootstrap numa chamada de rede deixaria a tela em branco com o backend fora do
ar. Assim o app sobe e só a primeira navegação espera.

### Uma fonte só para navegação e rotas

As rotas de módulo são **geradas** a partir de `core/navigation.ts`. A barra
lateral e as permissões de rota não podem divergir porque leem a mesma lista.

### Code splitting (UI-085)

Tudo é `loadComponent`. O bundle inicial caiu de **1,02 MB para 489 kB**
(114 kB comprimido) — cada módulo agora é um pedaço que só baixa quando o
usuário entra nele.

### Paridade recuperada

O `HttpClient` não tem tempo limite, e o cliente do projeto React tinha 30 s.
Um `timeoutInterceptor` restaura isso. Fica como o **mais interno** da cadeia,
para o limite valer por tentativa: a repetição depois da renovação ganha os
seus próprios 30 s em vez de herdar o que sobrou da primeira. O
`TokenRefreshService`, que passa por fora dos interceptors, tem o seu próprio.

## Componentes base (`src/app/ui/`, UI-006)

| Componente | O que resolve |
| --- | --- |
| `DecimalField` | **Dinheiro como string** (RN-012) — ver abaixo |
| `TextField` / `SelectField` | Rótulo, dica e erro ligados por `aria-describedby` |
| `DataTable` | Listagem com paginação **server-side** |
| `FilterBar` | Busca com atraso + filtros |
| `ErrorAlert` | `ApiError` → alerta, com a lista de erros de validação |
| `StateScreen` | Estados vazio, erro e "em construção" (UI-081) |
| `AsyncState` | Carregando → erro → vazio → conteúdo, na mesma ordem em toda tela (UI-081) |
| `LoadingBlock` | Esqueleto de carregamento, com `role="status"` (UI-081) |
| `ConfirmDialog` + `ConfirmService` | Confirmação única das ações irreversíveis (UI-081) |
| `PrintExport` | Imprimir a tela e exportar o filtro inteiro em CSV (RF-113 — UI-080) |

Todos os campos implementam `ControlValueAccessor`, então funcionam com
`ngModel` e com formulários reativos.

### O `DecimalField` e a RN-012

O usuário digita em pt-BR ("1.234,56") e o componente entrega o canônico
("1234.56") como **string**. Em nenhum momento o valor passa por `number`.

⚠️ **Não troque por `p-inputnumber`.** Aquele trafega `number`, e o
arredondamento binário faria a tela deixar de fechar com o `numeric(18,2)` do
banco. Este componente envolve o `pInputText` e mantém a lógica de
`core/lib/decimal.ts`.

> Verificado por mutação: roteando o valor por `String(Number(...))`, os testes
> falham com *expected '0.1' to be '0.10'* e *expected '-6200' to be
> '-6200.00'*.

### Detalhes que os testes fixaram

- **Debounce da busca** — sem ele, "ferragens" digitado vira 9 consultas ao
  servidor. Os selects emitem na hora: a escolha já é deliberada, e esperar
  300 ms depois de um clique parece travamento.
- **A `p-table` dispara `onLazyLoad` ao montar** — sem a guarda no
  `DataTable`, toda listagem faria duas consultas ao abrir.

## Telas de autenticação (UI-002 / RF-008 / RF-009)

| Rota | Tela |
| --- | --- |
| `/login` | Entrar, com retorno à origem via `?origem=` |
| `/recuperar-senha` | Solicitar link de redefinição |
| `/redefinir-senha?token=…` | Definir nova senha |
| `/selecionar-empresa` | Escolher a empresa ativa (RF-005) |

**A recuperação não revela quem tem cadastro.** A API responde sempre a mesma
mensagem, exista ou não o e-mail — a tela apenas exibe o que veio. Revelar isso
seria uma forma de enumerar usuários.

**A validação de senha no cliente não substitui a do backend.** `validarSenha`
existe para o usuário não descobrir o problema depois de uma ida ao servidor;
quem decide é o `IsStrongPassword` da API.

Depois de redefinida, os campos são limpos — a senha não fica em memória.

### Aviso de expiração

[`SessionExpiryBanner`](src/app/auth/session-expiry-banner.ts) aparece na
moldura quando faltam menos de 2 minutos, com o botão de renovar. A expiração é
lida do payload do access token e serve **só** para avisar; a validade de
verdade é verificada pelo backend a cada requisição.

O relógio bate a cada 15 s: o aviso é dado em minutos, então precisão maior não
mudaria o que aparece e só gastaria detecção de mudanças.

### Campos como signals

Os campos das telas de autenticação são `signal`, não propriedades comuns. Em
modo zoneless, atribuir a uma propriedade dentro de um callback assíncrono não
notifica o Angular — funcionaria só por carona numa outra escrita de signal
próxima, o que é frágil demais para depender.

## Administração (Sprint 19 — UI-007 a UI-012)

As telas do módulo vivem em [`src/app/admin/`](src/app/admin), atrás da moldura
de abas do [`AdminShell`](src/app/admin/admin-shell.ts); a trilha de auditoria
fica em [`src/app/audit/`](src/app/audit), sob a rota `/auditoria` do menu.

| Rota | Tela | Exigência |
| --- | --- | --- |
| `/administracao/empresa` | Cadastro da empresa ativa (UI-007) | `company:READ` |
| `/administracao/empresas` | Empresas do grupo e ciclo de vida (UI-007) | super admin |
| `/administracao/empresas/:id` | Cadastro de uma empresa, `nova` para criar | super admin |
| `/administracao/filiais` | Filiais da empresa ativa (UI-007) | `branches:READ` |
| `/administracao/configuracoes` | Categorias, centros de custo e parâmetros (UI-008) | `categories`/`cost-centers`/`settings:READ` |
| `/administracao/usuarios` | Vínculos da empresa e, para o super admin, usuários (UI-009) | `memberships:READ` |
| `/administracao/perfis` | Matriz de permissões por recurso (UI-010) | `roles:READ` |
| `/administracao/alcadas` | Faixas de valor por processo e perfil (UI-011) | `approval-thresholds:READ` |
| `/auditoria` | Trilha append-only com período e evento (UI-012) | `audit:READ` |

Três decisões que o código repete e que valem registro:

- **Dois níveis de autorização na mesma tela.** `/companies` e `/users` são
  rotas de plataforma (`@RequireSuperAdmin()`) e saem com `semEmpresa()`, sem o
  `x-company-id`; `/branches`, `/memberships`, `/roles` e
  `/approval-thresholds` são da empresa ativa e levam o cabeçalho. Misturar os
  dois numa listagem só produziria 403 — daí a aba de usuários da plataforma só
  aparecer para o super admin.
- **Filtro e paginação são do servidor.** O [`ListState`](src/app/core/lib/list-state.ts)
  concentra o ciclo filtro → consulta → página → erro e descarta a resposta de
  uma consulta já substituída. A única busca local é a da matriz de permissões:
  o catálogo vem inteiro numa resposta, não é coleção paginada.
- **O super admin escolhe entre todas as empresas.** O `PermissionsGuard`
  aceita dele qualquer `x-company-id`, sem exigir vínculo, então o
  `CompanyService` mescla os vínculos com `GET /companies`. Sem isso, uma
  instalação nova ficava sem saída: o super admin nasce sem vínculo e a tela que
  cadastra a primeira empresa é interna. Por isso também `/administracao/empresas`
  é a única rota que abre sem empresa ativa, e as guardas esperam essa lista
  antes de decidir — num F5 ela chega depois da navegação.
- **Só se envia o que o DTO aceita.** O backend valida com
  `forbidNonWhitelisted`, então campo em branco não vira `""` no corpo, o CNPJ
  não vai no `PATCH` (o `UpdateCompanyDto` o omite) e a trilha não recebe `q`,
  que o `QueryAuditDto` não declara.

O que o Figma desenha e a API ainda não sustenta ficou de fora em vez de virar
dado inventado: cidade/UF na listagem de filiais (o endereço não vem na lista —
apareceria como um N+1), o filtro por regime tributário nas empresas e os KPIs
de convites e 2FA da UI-009.

## Módulos (Sprints 20 a 29)

Todo módulo tem a mesma forma, e isso é o que permite ler qualquer um deles
depois de ter lido um:

- uma **moldura de abas** (`*-shell`) e as telas nas rotas filhas de um
  `*.routes.ts`, com a permissão de cada uma em `data.permissions`;
- a sub-navegação sai da **mesma lista** que gera as rotas — aba e rota não
  podem divergir, do mesmo jeito que a barra lateral e `core/navigation.ts`;
- listagem com filtro e paginação **do servidor**, pelo
  [`ListState`](src/app/core/lib/list-state.ts), que descarta a resposta de uma
  consulta já substituída;
- dinheiro entra e sai como **string** (RN-012), pelo `DecimalField` e pelos
  pipes de `core/lib`.

| Rota | Sprint — itens | Telas |
| --- | --- | --- |
| `/rh` | 20 — UI-013 a UI-017 | `funcionarios` (com detalhe, histórico e verbas), `estrutura`, `verbas`, `reembolsos` |
| `/cadastros` | 21 — UI-018 a UI-020 | `parceiros`, `condicoes`, `catalogo`, `classificacao` |
| `/estoque` | 21 — UI-021 a UI-023 | `saldos`, `locais`, `movimentacoes`, `inventarios` |
| `/financeiro` | 22 — UI-024 a UI-029 | `titulos` (novo, detalhe, editar), `aprovacoes`, `inadimplencia`, `fluxo-caixa`, `cenarios`, `alertas` |
| `/compras` | 23 — UI-030 a UI-035 | `pedidos` (novo, detalhe, editar, receber), `recebimentos`, `historico` |
| `/fiscal` | 24 — UI-036 a UI-041 | `documentos`, `importar`, `coleta` |
| `/bancos` | 25 — UI-042 a UI-047 | `contas`, `ordens` (nova e detalhe), `extratos`, `movimentos`, `operacoes` |
| `/conciliacao` | 26 — UI-048 a UI-053 | `movimentos` (com detalhe e sugestões), `divergencias`, `historico`, `regras` |
| `/contabil` | 27 — UI-054 a UI-060 | `plano`, `classificacao`, `lancamentos` (com o lançamento manual), `razao`, `balancete`, `dre`, `periodos`, `exportacao` |
| `/fiscal` | 28 — UI-061 a UI-064 | `parametros`, `classificacoes`, `regras`, `relatorios`, `transmissoes` |
| `/automacao` | 28 — UI-065 a UI-067 | `notificacoes`, `preferencias`, `regras` |
| `/relatorios` | 29 — UI-068 a UI-073 | `financeiro`, `carteira`, `caixa`, `compras`, `pessoal`, `contabil-fiscal` |
| `/integracoes` | 29 — UI-074/UI-075 | `provedores`, `monitoramento` |

Duas coisas que a tabela não diz:

- **`/fiscal` é um módulo só, de duas sprints.** Os documentos da Sprint 24
  (M07) e a tributação da Sprint 28 (M12) moram na mesma árvore de rotas porque,
  para o usuário, são a mesma área — e porque é da nota que a classificação
  fiscal fala. Cada aba continua exigindo a sua própria permissão.
- **O recorte dos relatórios vive no módulo.** O `ReportFilterStore` é fornecido
  na rota de `/relatorios`, e não na raiz: o filtro acompanha a troca de painel
  dentro do módulo e morre ao sair dele (UI-072).

## Transversais (Sprint 30 — UI-076 a UI-081)

| Rota | O que é |
| --- | --- |
| `/design-system` | **Documentação viva** (UI-076): a aplicação desenhando os próprios componentes e tokens, nos dois temas |
| `/preferencias` | Tema, densidade, colunas escondidas e filtros salvos (UI-078) |
| `/onboarding` | Assistente de primeira configuração da empresa (RF-006 — UI-079) |

**Tokens (UI-076).** Cor continua saindo inteira do preset
([`sge-preset.ts`](src/app/theme/sge-preset.ts)); o que
[`styles.scss`](src/styles.scss) acrescenta é o que o preset não modela — a
escala de espaço (`--sge-espaco-1..6`), o raio e a tipografia. São degraus, não
valores livres: valor fora da escala é sinal de componente faltando.

**Busca global (UI-077).** `Ctrl`/`Cmd` + `K` de qualquer tela. Não há endpoint
de busca única no backend: a busca reaproveita o `q` das listagens que já
existem, uma requisição por entidade e cinco linhas cada, só nos módulos que o
perfil libera — e uma entidade que falhar entra vazia em vez de derrubar o
resto.

**Preferências (UI-078).** Ficam no `localStorage`, por usuário: numa máquina
compartilhada a escolha de um não pode virar a tela do outro. Filtro salvo
guarda também a empresa em que nasceu, porque carrega ids que só existem lá.
Densidade é uma classe no `<html>`, como o tema.

**Impressão e exportação (UI-080).** Impressão é a própria tela: o `@media
print` global tira barra superior, menu, ações e paginação — sem rota nem
layout paralelo para papel. O CSV sai do recorte inteiro (`ListState.exportar()`
pagina de cem em cem, até 2000 linhas) com `;`, aspas e BOM, as mesmas escolhas
do exportador do backend.

**Confirmação (UI-081).** Toda ação irreversível de listagem — inativar,
excluir, encerrar, remover vínculo — passa pelo `ConfirmService`, que alimenta
um único `<sge-confirm-dialog>` montado na moldura autenticada. Fechar no `Esc`
conta como recusa.

## Acessibilidade e performance (Sprint 31 — UI-082 a UI-086)

**Navegação anunciada (UI-082).** Numa aplicação de página única, clicar em
"Financeiro" não produz som nenhum para quem usa leitor de tela, e o foco fica
parado no item do menu. O [`RouteAnnouncer`](src/app/core/a11y/route-announcer.ts)
resolve os dois: uma região `aria-live="polite"` anuncia o título da rota que
entrou, e o foco vai para o `<main>` (que carrega `tabindex="-1"` justamente
para poder recebê-lo), de onde o Tab percorre o conteúdo novo — critério 2.4.3.
A primeira navegação não mexe no foco.

**Responsividade (UI-083).** A quebra é em **900px**, e não num aparelho: é a
largura em que a barra lateral de 232px e uma tabela de listagem param de
conviver. Abaixo dela a barra vira gaveta — que nasce fechada, fica `inert`
enquanto está fora da tela e volta a ser menu quando o aparelho gira. Isso é
estado, e mora no [`ViewportService`](src/app/core/layout/viewport.service.ts),
não em `window.innerWidth` lido dentro do template.

**Formatos pt-BR (UI-084).** Os pipes de [`core/lib/pipes.ts`](src/app/core/lib/pipes.ts)
formatam moeda, data e número **a partir da string canônica**. O valor nunca
passa por `number` no caminho da tela para a API — a formatação é de saída, e é
só isso.

**Performance (UI-085).** Três frentes: `loadComponent` em tudo (o bundle
inicial caiu de **1,02 MB para 489 kB**, 114 kB comprimido); o
[`queryCacheInterceptor`](src/app/core/api/query-cache.ts), com janela de 30 s
para dados de referência, chaveado por empresa e limpo na mutação; e rolagem
virtual no `DataTable` para as listagens longas.

**Auditoria (UI-086).** `npm run auditoria:ui` aplica as regras de
[docs/auditoria-ui-086.md](../docs/auditoria-ui-086.md) sobre as telas já
entregues. A execução final fecha com 0 achados, e a esteira roda a auditoria
junto com testes e build.

## Qualidade e entrega (Sprint 32 — UI-087 a UI-093)

**E2E de verdade, sem dublê (UI-087/UI-088).** A moldura de
[`src/app/e2e/`](src/app/e2e) monta `AuthService`, `CompanyService`, guardas,
interceptors e o mapa de rotas **de produção**; só a rede é substituída pelo
`HttpTestingController`. São três roteiros: login, fluxos financeiros e
isolamento multiempresa — este último confere que trocar de empresa troca o
`x-company-id` e refaz as permissões, e que nada da empresa anterior sobrevive
na tela.

**Hardening (UI-089).** A CSP e os demais cabeçalhos ficam no
[`nginx.conf`](nginx.conf) da imagem. Na aplicação,
[`core/security/sanitize.ts`](src/app/core/security/sanitize.ts) trata o que o
template não trata: fórmula de planilha em campo exportado (`=HYPERLINK(...)`,
que o Excel executa ao abrir), esquema perigoso em `href` montado com valor da
API (`javascript:`, `data:`) e caractere de controle dentro de valor que vai
para arquivo ou log. O Angular já escapa interpolação — o risco que sobra é
esse.

**Observabilidade (UI-090).** O backend já registrava tudo com correlation id; o
navegador era o ponto cego. O `correlationInterceptor` manda o id, e o
[`ClientErrorsService`](src/app/core/observability/client-errors.service.ts)
guarda as últimas ocorrências: momento, rota, mensagem e o id. **Nunca** corpo
da requisição, token ou cabeçalho.

**Esteira (UI-091).** `.github/workflows/frontend.yml` roda tipos, auditoria de
interface, testes e build em série, monta a imagem Docker e guarda o bundle como
artefato. Publicar continua sendo decisão de quem opera.

A conferência de formatação (`npm run lint`) está no arquivo, mas **comentada**:
o código anterior à Sprint 32 nunca passou pelo Prettier e 174 arquivos divergem
da configuração. Ligar o passo hoje reprovaria todo commit até um
reformata-tudo — que é decisão do líder do projeto, não efeito colateral de uma
tarefa de esteira. O script existe e roda localmente; quando o repositório for
formatado de uma vez, basta descomentar.

**Ajuda e homologação (UI-092/UI-093).** O manual completo é
[docs/manual-do-usuario.md](../docs/manual-do-usuario.md); o botão `?` da barra
superior mostra o pedaço do módulo aberto, de
[`core/help/help-content.ts`](src/app/core/help/help-content.ts) — manual é o
que se lê antes, ajuda contextual é o que se consulta no meio de uma tarefa. Os
cenários de UAT, os apontamentos corrigidos e o checklist de go-live estão em
[docs/homologacao-uat.md](../docs/homologacao-uat.md).

## Telas de referência (Figma)

As telas de referência estão no Figma:
[SGE — Telas do sistema](https://www.figma.com/design/2fHfjDKNSzL2QJiM8jPkI5)
(74 telas). A estrutura delas é agnóstica de framework — a troca para Angular
não as invalida —, e desde a Sprint 18 a pintura acompanha o preset: as 74
telas foram recoloridas para o tema escuro (primária violeta, superfície
carvão azulado, campo com raio 8 e conteúdo com 12).

O arquivo também tem a coleção de variáveis `SGE · Tokens (PrimeNG)`, com as
primitivas `primary/*` e `surface/*` e os semânticos do Aura
(`content-background`, `text-muted-color`, `form-field-border-color`…) nos
modos **Claro** e **Escuro** — os mesmos dois lados que a função `light-dark()`
resolve em [`sge-preset.ts`](src/app/theme/sge-preset.ts).
