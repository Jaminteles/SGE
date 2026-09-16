import { ErrorHandler, Injectable, computed, inject, signal } from '@angular/core';

import { ApiError, NetworkError } from '../api/errors';
import { textoSeguro } from '../security/sanitize';

export interface OcorrenciaCliente {
  /** ISO 8601 — o mesmo formato do log do backend, para cruzar as duas pontas. */
  momento: string;
  /** Rota em que aconteceu, sem query string (pode conter filtro digitado). */
  rota: string;
  mensagem: string;
  /** Correlation id da requisição envolvida, quando houver (RNF-010). */
  correlationId: string | null;
  origem: 'http' | 'aplicacao';
}

/** Quantas ocorrências ficam guardadas. O suporte precisa das últimas, não do histórico. */
const LIMITE = 20;

/**
 * Captura de erros do cliente (RNF-010 — UI-090).
 *
 * O backend já registra tudo com correlation id; o navegador era o ponto cego.
 * Um erro que só acontece na máquina do usuário — uma resposta inesperada, um
 * `undefined` numa tela específica — chegava ao suporte como "deu erro".
 *
 * O que fica guardado é deliberadamente pobre: momento, rota, mensagem e o
 * correlation id. **Nunca** o corpo da requisição, o token, o cabeçalho ou o
 * conteúdo da tela — o objetivo é achar a requisição correspondente no log do
 * servidor, e para isso o id basta.
 *
 * O buffer é de memória e some no F5. Não é substituto de monitoramento: é o
 * que o usuário copia e cola no chamado, e o que o desenvolvedor lê no console
 * do navegador enquanto reproduz.
 */
@Injectable({ providedIn: 'root' })
export class ClientErrorsService {
  private readonly _ocorrencias = signal<OcorrenciaCliente[]>([]);

  readonly ocorrencias = this._ocorrencias.asReadonly();
  readonly ultima = computed<OcorrenciaCliente | null>(() => this._ocorrencias()[0] ?? null);

  registrar(erro: unknown, origem: OcorrenciaCliente['origem'] = 'aplicacao'): void {
    const ocorrencia: OcorrenciaCliente = {
      momento: new Date().toISOString(),
      rota: typeof location === 'undefined' ? '' : textoSeguro(location.pathname, 200),
      mensagem: textoSeguro(this.mensagem(erro), 300),
      correlationId: erro instanceof ApiError ? erro.correlationId : null,
      origem,
    };
    this._ocorrencias.update((atual) => [ocorrencia, ...atual].slice(0, LIMITE));
  }

  limpar(): void {
    this._ocorrencias.set([]);
  }

  /** Texto para o usuário colar no chamado — uma linha por ocorrência. */
  paraSuporte(): string {
    return this._ocorrencias()
      .map((o) => `${o.momento} ${o.rota} [${o.correlationId ?? 'sem id'}] ${o.mensagem}`)
      .join('\n');
  }

  private mensagem(erro: unknown): string {
    if (erro instanceof Error) return `${erro.name}: ${erro.message}`;
    return String(erro);
  }
}

/**
 * `ErrorHandler` da aplicação (UI-090).
 *
 * Registra e **continua** delegando ao tratador padrão do Angular: engolir o
 * erro deixaria o console limpo e o desenvolvedor cego. Erro de rede e 4xx já
 * viram alerta na tela pelo caminho normal e não precisam ser relançados no
 * console — o resto precisa.
 */
@Injectable()
export class SgeErrorHandler implements ErrorHandler {
  private readonly registro = inject(ClientErrorsService);
  private readonly padrao = new ErrorHandler();

  handleError(erro: unknown): void {
    const desembrulhado = this.desembrulhar(erro);

    // Erro de API já foi registrado pelo `correlationInterceptor`, com o id da
    // requisição — registrar de novo aqui duplicaria a ocorrência sem o id.
    if (!(desembrulhado instanceof ApiError)) {
      this.registro.registrar(desembrulhado, 'aplicacao');
    }

    // Falha de rede já chega ao usuário como alerta; o console repetiria o que
    // a tela mostrou.
    if (desembrulhado instanceof NetworkError) return;
    this.padrao.handleError(erro);
  }

  /** O Angular embrulha o erro original em `rejection` quando vem de Promise. */
  private desembrulhar(erro: unknown): unknown {
    if (erro && typeof erro === 'object' && 'rejection' in erro) {
      return (erro as { rejection: unknown }).rejection;
    }
    return erro;
  }
}
