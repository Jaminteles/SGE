import {
  HttpContext,
  HttpContextToken,
  HttpEvent,
  HttpInterceptorFn,
  HttpResponse,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { finalize, shareReplay, tap } from 'rxjs/operators';

import { activeCompanyStore } from '../company/active-company-store';

/**
 * Janela padrão de cache dos dados de referência (UI-085).
 *
 * Meio minuto é o tempo em que o usuário abre o select, fecha, muda de aba do
 * módulo e abre de novo. Categoria, unidade, filial e plano de contas não mudam
 * nessa escala — e, quando mudam, é este mesmo navegador que manda o PATCH, e a
 * mutação já limpa o cache.
 */
export const TTL_REFERENCIA_MS = 30_000;

/** Validade em milissegundos; `0` (o padrão) desliga o cache da requisição. */
export const CACHE_TTL = new HttpContextToken<number>(() => 0);

/** Marca uma consulta como cacheável: `this.http.get(url, { context: comCache() })`. */
export function comCache(ttlMs: number = TTL_REFERENCIA_MS, contexto = new HttpContext()) {
  return contexto.set(CACHE_TTL, ttlMs);
}

interface Entrada {
  resposta: HttpResponse<unknown>;
  expiraEm: number;
}

/**
 * Cache de consultas GET (RNF-008 — UI-085).
 *
 * Existe por causa de um padrão que se repete em quase toda tela: o mesmo
 * `GET /branches` sai de novo a cada formulário aberto, a cada select montado,
 * a cada volta para a listagem. É a mesma resposta, e a rede paga por ela todas
 * as vezes.
 *
 * Três garantias, nesta ordem de importância:
 *
 * 1. **A chave inclui a empresa ativa.** Sem isso, trocar de empresa mostraria
 *    a lista de filiais da empresa anterior — a RLS do banco teria feito o seu
 *    trabalho e o cache do navegador a desfaria. Isolamento é do backend, mas
 *    um cache que ignora o escopo vaza dado por conta própria.
 * 2. **Qualquer escrita invalida.** Um POST, PATCH, PUT ou DELETE em
 *    `categories` derruba tudo que foi guardado sob `categories`. O usuário que
 *    acabou de cadastrar uma categoria precisa vê-la no select seguinte.
 * 3. **Requisições idênticas simultâneas viram uma só.** Três componentes que
 *    pedem a mesma lista ao montar produzem um pedido, não três.
 *
 * Só entra aqui quem pede explicitamente (`comCache()`). Listagem paginada,
 * saldo, extrato e qualquer coisa que o usuário lê para decidir sobre dinheiro
 * ficam de fora: valor financeiro com meio minuto de atraso é valor errado.
 */
@Injectable({ providedIn: 'root' })
export class QueryCacheService {
  private readonly entradas = new Map<string, Entrada>();
  private readonly emVoo = new Map<string, Observable<HttpEvent<unknown>>>();

  /** Recurso da URL — o primeiro segmento do caminho (`categories/123` -> `categories`). */
  static recurso(url: string): string {
    return (
      url
        .replace(/^https?:\/\/[^/]+/i, '')
        .replace(/^\/+/, '')
        .split(/[/?]/)[0] ?? ''
    );
  }

  private chave(url: string, params: string): string {
    // A empresa ativa faz parte da identidade da resposta, não do enfeite.
    return `${activeCompanyStore.get() ?? 'sem-empresa'}|${url}|${params}`;
  }

  buscar(url: string, params: string): HttpResponse<unknown> | null {
    const chave = this.chave(url, params);
    const entrada = this.entradas.get(chave);
    if (!entrada) return null;
    if (entrada.expiraEm <= Date.now()) {
      this.entradas.delete(chave);
      return null;
    }
    return entrada.resposta;
  }

  emAndamento(url: string, params: string): Observable<HttpEvent<unknown>> | null {
    return this.emVoo.get(this.chave(url, params)) ?? null;
  }

  /**
   * Compartilha a requisição em curso e guarda a resposta quando ela chega.
   * Erro não é guardado: uma falha momentânea de rede não pode virar meio
   * minuto de tela vazia.
   */
  registrar(
    url: string,
    params: string,
    ttlMs: number,
    requisicao: Observable<HttpEvent<unknown>>,
  ): Observable<HttpEvent<unknown>> {
    const chave = this.chave(url, params);
    const compartilhada = requisicao.pipe(
      tap((evento) => {
        if (evento instanceof HttpResponse) {
          this.entradas.set(chave, { resposta: evento.clone(), expiraEm: Date.now() + ttlMs });
        }
      }),
      finalize(() => this.emVoo.delete(chave)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.emVoo.set(chave, compartilhada);
    return compartilhada;
  }

  /** Descarta o que foi guardado sob um recurso; sem argumento, descarta tudo. */
  invalidar(recurso?: string): void {
    if (!recurso) {
      this.entradas.clear();
      return;
    }
    for (const chave of [...this.entradas.keys()]) {
      if (QueryCacheService.recurso(chave.split('|')[1] ?? '') === recurso) {
        this.entradas.delete(chave);
      }
    }
  }
}

/**
 * Interceptor do cache (UI-085). Entra **depois** do `baseUrlInterceptor`, para
 * a chave ser a URL final, e antes do de autenticação — resposta servida do
 * cache não precisa de token novo nem de tempo limite.
 */
export const queryCacheInterceptor: HttpInterceptorFn = (req, next) => {
  const cache = inject(QueryCacheService);

  if (req.method !== 'GET') {
    // A escrita não espera a resposta para invalidar: se ela falhar, o pior que
    // acontece é uma consulta a mais. Se ela der certo e o cache tivesse ficado,
    // o usuário não veria o que acabou de gravar.
    cache.invalidar(QueryCacheService.recurso(req.url));
    return next(req);
  }

  const ttl = req.context.get(CACHE_TTL);
  if (ttl <= 0) return next(req);

  const params = req.params.toString();
  const guardada = cache.buscar(req.url, params);
  if (guardada) return of(guardada.clone());

  const emVoo = cache.emAndamento(req.url, params);
  if (emVoo) return emVoo;

  return cache.registrar(req.url, params, ttl, next(req));
};
