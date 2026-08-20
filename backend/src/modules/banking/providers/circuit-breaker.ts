/**
 * Disjuntor por provedor (RNF-011).
 *
 * Quando o banco está fora, insistir a cada job é gastar o pool de conexões e
 * as tentativas de todas as transações da fila contra um endereço que não
 * responde. Depois de `failureThreshold` falhas seguidas o circuito abre e as
 * chamadas seguintes falham na hora — como falha *retentável*, para que a fila
 * as reagende com backoff em vez de matá-las.
 *
 * Meia-abertura: passado `openMs`, a próxima chamada passa. Se der certo, o
 * circuito fecha; se falhar, reabre.
 */
export interface CircuitBreakerOptions {
  failureThreshold: number;
  openMs: number;
}

type CircuitState = 'FECHADO' | 'ABERTO' | 'MEIO_ABERTO';

interface Circuit {
  state: CircuitState;
  failures: number;
  openedAt: number;
}

export class CircuitBreaker {
  private readonly circuits = new Map<string, Circuit>();

  constructor(private readonly options: CircuitBreakerOptions) {}

  /** Situação corrente do circuito — `ABERTO` recusa sem chamar. */
  check(key: string): CircuitState {
    const circuit = this.circuits.get(key);
    if (!circuit || circuit.state === 'FECHADO') {
      return 'FECHADO';
    }
    if (circuit.state === 'ABERTO' && Date.now() - circuit.openedAt >= this.options.openMs) {
      circuit.state = 'MEIO_ABERTO';
    }
    return circuit.state;
  }

  recordSuccess(key: string): void {
    this.circuits.delete(key);
  }

  recordFailure(key: string): void {
    const circuit = this.circuits.get(key) ?? {
      state: 'FECHADO' as CircuitState,
      failures: 0,
      openedAt: 0,
    };
    circuit.failures += 1;
    if (circuit.state === 'MEIO_ABERTO' || circuit.failures >= this.options.failureThreshold) {
      circuit.state = 'ABERTO';
      circuit.openedAt = Date.now();
    }
    this.circuits.set(key, circuit);
  }
}
