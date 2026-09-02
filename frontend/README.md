# SGE — Interface Web

Interface do Sistema de Gestão Empresarial e Financeira (Fase 9 do
planejamento, itens `UI-xxx`). React + TypeScript sobre Vite, consumindo a API
REST do [backend](../backend/README.md).

A Sprint 18 entrega a **fundação**: projeto, autenticação, empresa ativa,
adaptação da interface às permissões do perfil, layout/navegação, tratamento de
erro da API e os componentes base de listagem e formulário. As telas de cada
módulo entram nas Sprints 19 a 24.

## Executar

```bash
npm install
npm run dev      # http://localhost:5173 (proxy /api -> http://localhost:3000)
```

O backend precisa estar no ar e com `CORS_ORIGINS` incluindo a origem do app
(em desenvolvimento o proxy do Vite dispensa CORS).

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Type check do projeto + build de produção em `dist/` |
| `npm run lint` | ESLint (com Prettier) |
| `npm test` | Testes (Vitest + Testing Library) |
| `npm run test:cov` | Testes com cobertura |

Variáveis de ambiente: veja `.env.example`. Nenhum segredo pode entrar aqui —
o bundle é público.

## Decisões da fundação

**Sessão (UI-002).** O access token fica só em memória; o refresh token vai
para `sessionStorage` (some ao fechar a aba). A API não oferece cookie
httpOnly, então essa é a menor janela de exposição possível hoje. O cliente
HTTP renova o token **uma única vez por 401**, com as demais requisições
concorrentes esperando a mesma renovação, e derruba a sessão se a renovação
falhar.

**Empresa ativa (UI-003).** Toda requisição por empresa leva o cabeçalho
`x-company-id`. A escolha é validada contra os vínculos do usuário e guardada
em `localStorage`; um id que não pertence ao usuário é descartado. O isolamento
real continua sendo a RLS do PostgreSQL — o cabeçalho apenas informa o contexto.

**Permissões (UI-004).** `GET /auth/me` devolve, por vínculo, os códigos
`recurso:AÇÃO` do perfil. A interface usa isso para esconder e desabilitar o
que o usuário não pode fazer. **Isso não é controle de acesso**: quem autoriza
é o `PermissionsGuard` somado à RLS, a cada requisição. Esconder um botão não
protege nada.

**Dinheiro (UI-006, RN-012).** Valor monetário é `string` do começo ao fim —
input, estado, DTO e resposta. Nada de `number` no caminho, para o que aparece
na tela fechar com o `numeric(18,2)` do banco. Ver `src/lib/decimal.ts` e
`src/ui/DecimalField.tsx`.

**Erros da API (UI-005).** O envelope
`{ statusCode, error, message, path, timestamp }` do backend é traduzido em
`ApiError` e exibido pelo `ErrorAlert`, incluindo a lista de erros de validação.
Falha de rede vira `NetworkError`.

## Estrutura

```
src/
  api/        cliente HTTP, tradução de erro e contratos da API
  auth/       sessão, login, recuperação de senha, aviso de expiração
  authz/      permissões do perfil (uso de interface)
  company/    empresa ativa e seleção
  layout/     moldura autenticada e navegação por módulo
  lib/        decimal, formatação e configuração
  routes/     rotas, guardas e páginas
  ui/         componentes base (tabela, filtros, campos, alertas)
```
