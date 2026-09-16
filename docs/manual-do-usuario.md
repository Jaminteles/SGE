# Manual do usuário — SGE

Sistema de Gestão Empresarial e Financeira. Este manual é para quem **usa** o
sistema. A ajuda de cada módulo também aparece dentro da própria tela, no botão
`?` da barra superior (UI-092): o manual é o que se lê antes, a ajuda contextual
é o que se consulta no meio de uma tarefa.

---

## 1. Antes de começar

### Entrar

1. Informe e-mail e senha na tela de entrada.
2. Se você tem vínculo com mais de uma empresa, escolha a empresa ativa.
3. Se só tem uma, o sistema já entra nela.

**Tudo o que você vê é da empresa ativa.** O nome dela fica no topo da tela, ao
lado do seu usuário; clicar ali troca de empresa. Trocar de empresa recarrega os
dados — nada da empresa anterior permanece na tela.

### Sessão

- A sessão avisa antes de expirar e oferece o botão **Renovar sessão**.
- Enquanto você estiver trabalhando, a renovação acontece sozinha.
- Depois de **30 minutos sem nenhuma interação**, a sessão cai e você volta à
  tela de entrada com o aviso de inatividade. É proteção da máquina destravada.

### O que você enxerga

O menu lateral mostra **todos** os módulos. O que seu perfil não alcança aparece
com um cadeado, em vez de sumir — assim você sabe que o módulo existe e pode
pedir acesso ao administrador da empresa.

---

## 2. A tela, em geral

| Elemento | Onde | Para quê |
| --- | --- | --- |
| Busca global | topo | ir direto a um título, parceiro, produto ou ordem |
| Empresa ativa | topo | trocar a empresa dos dados em tela |
| Ajuda (`?`) | topo | ajuda do módulo aberto |
| Preferências | topo | tema, densidade da tela e formato de exibição |
| Sair | topo | encerrar a sessão |
| Imprimir / CSV | barra das listagens | levar a listagem ao papel ou à planilha |

Atalhos de teclado e leitores de tela: a aplicação segue WCAG 2.1 AA. O link
**Pular para o conteúdo** é o primeiro elemento focável de toda tela, e a troca
de rota é anunciada.

---

## 3. Módulos

### 3.1 Cadastros

Parceiro é **um cadastro só**, marcado como cliente, fornecedor ou os dois. Não
existe cadastro separado, e não se exclui parceiro com movimento — inativa-se.

Cadastre categorias e centros de custo **antes** de começar a lançar: relatório
sem classificação não se conserta depois.

### 3.2 Financeiro

Contas a pagar e a receber ficam na mesma tela, distinguidas pelo tipo.

**Lançar um título**

1. Informe parceiro, valor, vencimento e classificação.
2. Escolha a condição de pagamento (ela sugere o parcelamento) ou informe as
   parcelas manualmente — elas precisam somar o valor líquido.
3. Salve. Acima da faixa de alçada, envie para aprovação.

**Aprovação**

- Quem lança **não** aprova. É segregação de funções.
- Enquanto a aprovação estiver pendente, a baixa fica bloqueada.

**Baixa (quitação)**

1. Abra o título e clique em **Registrar baixa** na parcela.
2. Informe o **principal quitado** — só ele abate o saldo.
3. Para parcela vencida, deixe **aplicar encargos** ligado: juros e multa são
   calculados pelo servidor, com a regra do título. A tela não inventa a conta.
4. Confirme.

> Clicar duas vezes não gera duas baixas: cada baixa leva uma chave própria, e a
> segunda tentativa devolve a que já foi registrada.

**Estorno**

Baixa não se apaga: **estorna-se, com motivo**. A original continua no
histórico e o saldo da parcela volta a ficar em aberto.

### 3.3 Bancos

**Emitir uma ordem de pagamento**

1. Escolha a conta de origem (só aparecem as habilitadas para pagar).
2. Escolha a modalidade — PIX, boleto, TED/DOC ou transferência interna — e
   preencha os dados do favorecido.
3. Informe valor e, se for agendada, a data.
4. **Revisar e enviar** → confira o resumo → **Enviar ordem**.

A confirmação existe porque depois dela o dinheiro está a caminho.

**Acompanhar**

A resposta do banco chega por conta própria. A tela de **Operações assíncronas**
mostra as tentativas. Repetição de tentativa nunca duplica a ordem.

**Cancelar**: só enquanto a ordem não saiu, e se o provedor aceitar. A tela
informa quando ainda é possível.

### 3.4 Conciliação

Conciliar **não movimenta dinheiro**: apenas afirma que a linha do extrato
corresponde a um lançamento que já existe.

1. Importe o extrato em **Bancos → Extratos**.
2. Abra **Conciliação → Movimentos** e escolha uma linha.
3. Aceite a sugestão de maior score ou escolha o título manualmente.
4. Valor diferente do esperado exige justificativa.
5. Linha sem par: marque como **ignorado**, com motivo.

Errou? **Desfaça o vínculo com motivo** — fica registrado quem desfez e por quê.

### 3.5 Compras e Estoque

- O recebimento registra a quantidade **recebida de verdade**; a divergência com
  o pedido fica registrada, e o pedido continua aberto pelo saldo.
- Toda movimentação de estoque exige motivo.
- Diferença de saldo se resolve por **inventário**, que congela a contagem e
  gera o ajuste com histórico.

### 3.6 Fiscal e Contábil

- Documento fiscal duplicado é apontado **antes** de entrar.
- A leitura do XML roda em segundo plano; o monitor mostra o andamento e permite
  reprocessar o que falhou.
- Lançamento contábil é partida dobrada: débito e crédito precisam fechar.
- Período fechado não aceita lançamento retroativo. Reabrir é decisão da
  contabilidade, e fica auditado.

### 3.7 Relatórios

O recorte escolhido na barra de filtros acompanha a troca de painel dentro do
módulo. **Imprimir** usa a própria tela, sem o menu. **CSV** exporta o filtro
inteiro, não só a página visível — e avisa quando o arquivo é truncado pelo
limite de linhas.

### 3.8 Auditoria

Quem fez o quê, quando e de onde. Abrir um registro mostra o antes e o depois.
Senha, token e credencial **nunca** entram na trilha.

---

## 4. Quando algo dá errado

| Mensagem | O que significa | O que fazer |
| --- | --- | --- |
| "Você não tem permissão para esta ação" | seu perfil não alcança a operação nesta empresa | peça a permissão ao administrador da empresa |
| "Sua sessão expirou" | o token não pôde ser renovado | entre novamente |
| "Sessão encerrada por inatividade" | 30 minutos sem interação | entre novamente |
| "Sem conexão com o servidor" | a requisição não chegou | verifique a rede e repita; operação de dinheiro não duplica no retry |
| "O registro já existe ou foi alterado por outra pessoa" | outra pessoa mexeu no mesmo registro | recarregue a tela e refaça |
| Erro do servidor com **código da ocorrência** | falha inesperada | copie o código e abra o chamado |

O **código da ocorrência** é a chave que liga o que você viu na tela ao registro
do servidor. Com ele, o suporte encontra exatamente a sua requisição no log.

---

## 5. Para o administrador da empresa

1. Cadastre a empresa e as filiais.
2. Crie os perfis de acesso com as permissões mínimas de cada função.
3. Vincule os usuários aos perfis.
4. Defina as faixas de **alçada de aprovação** por valor.
5. Cadastre contas bancárias, categorias, centros de custo e condições de
   pagamento.
6. Use o assistente de **primeira configuração** para conferir o que falta.

Permissão retirada vale na próxima entrada do usuário no sistema — mas o
servidor já recusa a ação imediatamente.

---

## 6. Onde mais procurar

| Assunto | Documento |
| --- | --- |
| Requisitos do sistema | `docs/ERS_Sistema_Gestao_Empresarial_Financeira_v1.0.docx` |
| Modelo de dados | `docs/MODELO_CONCEITUAL.md` |
| Roteiro de homologação | `docs/homologacao-uat.md` |
| Acessibilidade e responsividade | `docs/auditoria-ui-086.md` |
| API REST | `/api/docs` (fora de produção) ou `GET /api/v1/integrations/api-docs` |
