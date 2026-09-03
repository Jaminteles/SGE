# SGE — Interface Web (Angular)

Interface do Sistema de Gestão Empresarial e Financeira em **Angular 21 + PrimeNG**.

> **Estado:** fundação da Sprint 18 **completa**, com 117 testes passando. A
> fundação anterior em React foi removida no commit seguinte ao `483e777`; para
> consultá-la, `git show 483e777:frontend/`.

## Executar

```bash
npm install
npm start      # http://localhost:4200
```

| Comando | O que faz |
| --- | --- |
| `npm start` | Servidor de desenvolvimento |
| `npm run build` | Build de produção em `dist/` |
| `npm test` | Testes (Vitest — runner padrão do Angular 21) |

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
baseUrl → erro → empresa → auth → backend
```

O de auth fica mais interno de propósito: a repetição depois da renovação
precisa acontecer **antes** da tradução de erro, senão a segunda tentativa
nunca teria chance de dar certo.

| Interceptor | O que faz |
| --- | --- |
| `baseUrlInterceptor` | Prefixa `/api/v1`, para os services escreverem `'auth/me'` |
| `errorInterceptor` | Envelope do backend → `ApiError`; status 0 → `NetworkError` |
| `companyInterceptor` | `x-company-id` da empresa ativa (RF-005) |
| `authInterceptor` | `Bearer`, e no 401 renova e repete **uma vez** |

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
com a exigência de cada item. A barra lateral passa a consumi-la no passo
seguinte, junto com as rotas — hoje o shell ainda usa a lista fixa.

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

## Próximo passo

As telas dos módulos — Sprints 19 a 24, com as 74 telas do Figma como
referência. A conferência do fluxo completo (login real, troca de empresa,
permissões) ainda depende do backend NestJS no ar.

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
