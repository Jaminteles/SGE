import { NAVIGATION } from '../navigation';

export interface AjudaPergunta {
  pergunta: string;
  resposta: string;
}

export interface AjudaModulo {
  /** Rota do módulo, igual à de `core/navigation.ts`. */
  path: string;
  titulo: string;
  /** Uma frase: o que o módulo resolve. */
  resumo: string;
  /** O caminho mais comum, na ordem em que se faz. */
  passos: string[];
  /** As dúvidas que chegam ao suporte — não a documentação do campo. */
  duvidas: AjudaPergunta[];
}

/**
 * Ajuda contextual por módulo (UI-092).
 *
 * O manual completo está em `docs/manual-do-usuario.md`; isto é o pedaço que
 * aparece **dentro** da tela, respondendo sobre o módulo aberto. A divisão é
 * proposital: manual é o que se lê antes, ajuda contextual é o que se consulta
 * no meio de uma tarefa — e quem está no meio de uma tarefa não lê um capítulo.
 *
 * Por isso o conteúdo é curto e responde "o que faço agora", e não "o que este
 * campo significa". Regra de negócio que o usuário precisa entender (alçada,
 * idempotência, competência contábil) entra aqui; nome de campo, não.
 *
 * As chaves são as rotas de `core/navigation.ts` — um teste garante que todo
 * módulo navegável tem ajuda, para nenhum ficar com o botão mudo.
 */
export const AJUDA: AjudaModulo[] = [
  {
    path: '/',
    titulo: 'Início',
    resumo: 'Visão do dia: o que vence, o que espera aprovação e o que precisa de atenção.',
    passos: [
      'Confira os vencimentos do dia e da semana.',
      'Abra o que está pendente de aprovação pelo atalho do painel.',
      'Use a busca no topo para ir direto a um título, parceiro ou ordem.',
    ],
    duvidas: [
      {
        pergunta: 'Por que vejo menos módulos que meu colega?',
        resposta:
          'O menu mostra todos os módulos, mas deixa desabilitado o que seu perfil não alcança. Peça a permissão ao administrador da empresa.',
      },
      {
        pergunta: 'Estou vendo os dados de outra empresa.',
        resposta:
          'Troque a empresa ativa no botão ao lado do seu nome, no topo. Todo dado da tela é da empresa ativa.',
      },
    ],
  },
  {
    path: '/administracao',
    titulo: 'Administração',
    resumo: 'Empresa, filiais, usuários, perfis de acesso e parâmetros do sistema.',
    passos: [
      'Cadastre a empresa e as filiais antes de qualquer movimento.',
      'Crie os perfis de acesso e só então vincule os usuários.',
      'Defina as faixas de alçada de aprovação em "Alçadas".',
    ],
    duvidas: [
      {
        pergunta: 'Tirei uma permissão e o usuário continua vendo a tela.',
        resposta:
          'A permissão vale na próxima entrada dele no sistema. Enquanto isso, o servidor já recusa a ação — ele vê a tela, não consegue usá-la.',
      },
      {
        pergunta: 'Para que serve a alçada?',
        resposta:
          'Ela define a partir de que valor um título precisa de aprovação antes de ser pago, e quem pode aprovar.',
      },
    ],
  },
  {
    path: '/cadastros',
    titulo: 'Cadastros',
    resumo: 'Parceiros, produtos, condições de pagamento e as classificações usadas nas telas.',
    passos: [
      'Cadastre o parceiro marcando se ele é cliente, fornecedor ou os dois.',
      'Informe a condição de pagamento padrão — ela sugere o parcelamento dos títulos.',
      'Use categorias e centros de custo desde o começo: relatório sem classificação não se conserta depois.',
    ],
    duvidas: [
      {
        pergunta: 'Preciso cadastrar o mesmo parceiro duas vezes, como cliente e fornecedor?',
        resposta: 'Não. É um cadastro só, com as duas marcações ligadas.',
      },
      {
        pergunta: 'Não consigo excluir um parceiro.',
        resposta:
          'Parceiro com movimento não é excluído — é inativado. O histórico precisa continuar existindo.',
      },
    ],
  },
  {
    path: '/rh',
    titulo: 'RH',
    resumo: 'Colaboradores, estrutura organizacional, folha e reembolsos.',
    passos: [
      'Cadastre o colaborador e vincule-o à filial e ao centro de custo.',
      'Registre a remuneração — o histórico de alterações fica guardado.',
      'Reembolsos aprovados viram título a pagar no Financeiro.',
    ],
    duvidas: [
      {
        pergunta: 'Alterei o salário e o valor antigo sumiu?',
        resposta: 'Não. A alteração é um novo registro no histórico; o anterior continua lá.',
      },
    ],
  },
  {
    path: '/compras',
    titulo: 'Compras',
    resumo: 'Pedidos de compra, recebimento de mercadoria e histórico por fornecedor.',
    passos: [
      'Monte o pedido com os itens e a condição de pagamento.',
      'Registre o recebimento conferindo quantidade e valor.',
      'A divergência entre pedido e recebimento fica registrada, não é corrigida em silêncio.',
    ],
    duvidas: [
      {
        pergunta: 'Recebi menos do que pedi.',
        resposta:
          'Registre a quantidade recebida de verdade. O pedido continua aberto pelo saldo restante.',
      },
    ],
  },
  {
    path: '/estoque',
    titulo: 'Estoque',
    resumo: 'Saldos por local, movimentações e inventários.',
    passos: [
      'Confira o saldo por local antes de movimentar.',
      'Toda movimentação exige motivo — é o que explica a diferença depois.',
      'O inventário congela a contagem e gera o ajuste ao ser fechado.',
    ],
    duvidas: [
      {
        pergunta: 'O saldo não bate com a contagem.',
        resposta:
          'Abra um inventário: é ele que registra a contagem e gera o ajuste com histórico.',
      },
    ],
  },
  {
    path: '/financeiro',
    titulo: 'Financeiro',
    resumo: 'Contas a pagar e a receber, baixas, aprovações, inadimplência e fluxo de caixa.',
    passos: [
      'Lance o título informando parceiro, valor e vencimento.',
      'Acima da alçada, envie para aprovação — a baixa fica bloqueada até a decisão.',
      'Na baixa, informe o principal quitado; juros e multa do atraso são calculados pelo servidor.',
    ],
    duvidas: [
      {
        pergunta: 'Cliquei em "Registrar baixa" duas vezes. Vai baixar duas vezes?',
        resposta:
          'Não. Cada baixa leva uma chave própria: a segunda tentativa da mesma baixa devolve a que já foi registrada.',
      },
      {
        pergunta: 'Baixei errado. Dá para apagar?',
        resposta:
          'Não se apaga: estorna-se, com motivo. A baixa original continua no histórico e o saldo volta a ficar em aberto.',
      },
      {
        pergunta: 'Por que não consigo aprovar o título que eu mesmo lancei?',
        resposta: 'Quem lança não aprova. É a segregação de funções exigida pela auditoria.',
      },
    ],
  },
  {
    path: '/bancos',
    titulo: 'Bancos',
    resumo: 'Contas bancárias, ordens de pagamento, extratos e operações assíncronas.',
    passos: [
      'Cadastre a conta e marque se ela pode pagar, receber ou ambos.',
      'Monte a ordem, revise o resumo e confirme — depois disso o dinheiro está a caminho.',
      'Acompanhe o retorno do banco em "Operações assíncronas".',
    ],
    duvidas: [
      {
        pergunta: 'A ordem ficou "enviada" e não mudou.',
        resposta:
          'O banco responde por conta própria. A tela de operações mostra as tentativas; nenhuma delas duplica a ordem.',
      },
      {
        pergunta: 'Dá para cancelar uma ordem?',
        resposta:
          'Só enquanto ela não saiu, e se o provedor aceitar. A tela informa quando o cancelamento ainda é possível.',
      },
    ],
  },
  {
    path: '/conciliacao',
    titulo: 'Conciliação',
    resumo: 'Casar as linhas do extrato com os títulos e as ordens já registrados.',
    passos: [
      'Importe o extrato em Bancos e abra a fila de movimentos a conciliar.',
      'Aceite a sugestão de maior score ou escolha o título manualmente.',
      'Diferença de valor exige justificativa; movimento sem par vira "ignorado", com motivo.',
    ],
    duvidas: [
      {
        pergunta: 'Conciliar paga o título?',
        resposta:
          'Não. Conciliar apenas afirma que a linha do extrato corresponde a um lançamento que já existe.',
      },
      {
        pergunta: 'Conciliei errado.',
        resposta: 'Desfaça o vínculo informando o motivo — fica registrado quem desfez e por quê.',
      },
    ],
  },
  {
    path: '/fiscal',
    titulo: 'Fiscal',
    resumo: 'Documentos fiscais, importação de NF, tributos e relatórios fiscais.',
    passos: [
      'Importe o XML ou capture o documento pelo monitor.',
      'Confira os tributos calculados e os vínculos com o pedido e o título.',
      'Documento duplicado é apontado antes de entrar, não depois.',
    ],
    duvidas: [
      {
        pergunta: 'A importação ficou processando.',
        resposta:
          'A leitura roda em segundo plano. O monitor mostra o andamento e permite reprocessar o que falhou.',
      },
    ],
  },
  {
    path: '/contabil',
    titulo: 'Contábil',
    resumo: 'Plano de contas, lançamentos, razão, balancete, DRE e exportação.',
    passos: [
      'Confira o plano de contas e as classificações antes de lançar.',
      'Lance a partida dobrada — débito e crédito precisam fechar.',
      'Feche o período para impedir lançamento retroativo.',
    ],
    duvidas: [
      {
        pergunta: 'Não consigo lançar em um mês passado.',
        resposta: 'O período está fechado. Reabri-lo é decisão da contabilidade e fica auditada.',
      },
    ],
  },
  {
    path: '/automacao',
    titulo: 'Automação',
    resumo: 'Notificações, alertas e regras que disparam sozinhas.',
    passos: [
      'Escolha quais eventos você quer receber em "Preferências de alerta".',
      'Crie a regra dizendo o que observar e o que fazer.',
      'Regra desligada para de disparar, mas continua guardada.',
    ],
    duvidas: [
      {
        pergunta: 'Parei de receber alerta.',
        resposta:
          'Confira se a regra está ativa e se o evento continua na sua lista de preferências.',
      },
    ],
  },
  {
    path: '/relatorios',
    titulo: 'Relatórios',
    resumo: 'Painéis e relatórios de carteira, caixa, compras e pessoal.',
    passos: [
      'Escolha o recorte na barra de filtros — ele acompanha a troca de painel.',
      'Use "Imprimir" para o papel e "CSV" para levar à planilha.',
      'O CSV sai com o filtro inteiro, não só com a página na tela.',
    ],
    duvidas: [
      {
        pergunta: 'O arquivo saiu incompleto.',
        resposta:
          'A exportação tem um limite de linhas e avisa quando trunca. Estreite o filtro e exporte de novo.',
      },
    ],
  },
  {
    path: '/auditoria',
    titulo: 'Auditoria',
    resumo: 'Quem fez o quê, quando e de onde.',
    passos: [
      'Filtre por usuário, recurso ou período.',
      'Abra o registro para ver o antes e o depois da alteração.',
    ],
    duvidas: [
      {
        pergunta: 'A trilha registra senha ou token?',
        resposta: 'Nunca. Credencial e segredo não entram em log nem em trilha de auditoria.',
      },
    ],
  },
  {
    path: '/integracoes',
    titulo: 'Integrações',
    resumo: 'Provedores externos, credenciais, parâmetros e monitoramento.',
    passos: [
      'Cadastre o provedor e guarde a credencial — ela é cifrada e nunca é reexibida.',
      'Acompanhe as chamadas no monitor e reprocesse o que falhou.',
    ],
    duvidas: [
      {
        pergunta: 'Reprocessar uma integração pode duplicar pagamento?',
        resposta:
          'Não. O reprocessamento usa a mesma chave da operação original; o provedor devolve o resultado que já existe.',
      },
    ],
  },
];

const POR_PATH = new Map(AJUDA.map((item) => [item.path, item]));

/**
 * Ajuda do módulo a que a URL pertence.
 *
 * Casa pelo primeiro segmento, e não pela rota exata: a ajuda é do módulo, e
 * `/financeiro/titulos/abc` é tão Financeiro quanto `/financeiro`. Rota sem
 * módulo (preferências, design system) devolve `null`, e o botão não aparece.
 */
export function ajudaPara(url: string): AjudaModulo | null {
  const caminho = url.split('?')[0].split('#')[0];
  const primeiro = caminho.split('/').filter(Boolean)[0];
  if (!primeiro) return POR_PATH.get('/') ?? null;
  return POR_PATH.get(`/${primeiro}`) ?? null;
}

/** Módulos navegáveis sem ajuda escrita — o teste de UI-092 exige lista vazia. */
export function modulosSemAjuda(): string[] {
  return NAVIGATION.filter((item) => !POR_PATH.has(item.path)).map((item) => item.path);
}
