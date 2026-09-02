import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, finalize, map, of, shareReplay, timeout } from 'rxjs';

import { SessionService } from '../auth/session.service';
import { config } from '../lib/config';
import { TEMPO_LIMITE_MS } from './interceptors';

interface RespostaRenovacao {
  accessToken?: string;
  refreshToken?: string;
}

/**
 * Renovação do access token, com garantia de **uma única chamada concorrente**.
 *
 * Quando várias requisições tomam 401 ao mesmo tempo — o caso comum de uma tela
 * que dispara quatro consultas de uma vez — todas precisam esperar a mesma
 * renovação. Sem isso, o backend receberia N chamadas a `/auth/refresh` e, se
 * o refresh token for rotativo, as tardias falhariam e derrubariam a sessão de
 * um usuário que estava perfeitamente logado.
 *
 * O `shareReplay` mantém o resultado para quem chegar depois; o `finalize`
 * libera o campo para que um 401 futuro possa renovar de novo.
 */
@Injectable({ providedIn: 'root' })
export class TokenRefreshService {
  private readonly sessao = inject(SessionService);

  /**
   * Cliente ligado direto ao `HttpBackend`: a renovação **não** passa pelos
   * interceptors. Se passasse, um 401 vindo do próprio `/auth/refresh`
   * dispararia outra renovação, em laço infinito.
   */
  private readonly http = new HttpClient(inject(HttpBackend));

  private emAndamento: Observable<boolean> | null = null;

  garantirRenovacao(): Observable<boolean> {
    this.emAndamento ??= this.renovar().pipe(
      finalize(() => {
        this.emAndamento = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.emAndamento;
  }

  private renovar(): Observable<boolean> {
    const refreshToken = this.sessao.refreshToken;
    if (!refreshToken) return of(false);

    const base = config.apiUrl.replace(/\/$/, '');
    return this.http.post<RespostaRenovacao>(`${base}/auth/refresh`, { refreshToken }).pipe(
      // Sem interceptor, sem tempo limite herdado: precisa do seu próprio,
      // senão um `/auth/refresh` pendurado trava toda navegação que o espera.
      timeout(TEMPO_LIMITE_MS),
      map((corpo) => {
        if (!corpo?.accessToken || !corpo.refreshToken) return false;
        this.sessao.definirTokens({
          accessToken: corpo.accessToken,
          refreshToken: corpo.refreshToken,
        });
        return true;
      }),
      // Qualquer falha na renovação é "não renovou" — quem chamou decide o que
      // fazer com isso (o interceptor encerra a sessão).
      catchError(() => of(false)),
    );
  }
}
