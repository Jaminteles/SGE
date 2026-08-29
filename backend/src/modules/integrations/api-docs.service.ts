import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/** O que o documento OpenAPI traz de estrutura, sem depender do tipo do Swagger. */
export interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  paths?: Record<string, Record<string, { summary?: string; tags?: string[] }>>;
  components?: { schemas?: Record<string, unknown> };
  [key: string]: unknown;
}

/**
 * Documentação da API (RF-131).
 *
 * O documento OpenAPI é montado uma vez no boot (`main.ts`) e guardado aqui. A
 * razão de existir um guardião em vez de simplesmente ligar o Swagger UI: a UI
 * é pública por natureza e fica desligada em produção, mas a *especificação*
 * continua sendo necessária para quem integra — e essa precisa sair por uma
 * rota autenticada, com permissão, como qualquer outro dado do sistema.
 *
 * Sem isso a escolha seria entre expor o mapa completo dos endpoints a quem
 * ainda não se autenticou e não ter documentação nenhuma em produção. Nenhuma
 * das duas é aceitável.
 */
@Injectable()
export class ApiDocsService {
  private document?: OpenApiDocument;

  /**
   * Chamado no boot, depois de `SwaggerModule.createDocument`.
   *
   * Recebe `object` e converte uma vez: `OpenAPIObject` do @nestjs/swagger
   * descreve o documento inteiro, e acoplar este serviço àquele tipo o faria
   * quebrar a cada mudança de assinatura de uma biblioteca que ele só lê.
   */
  set(document: object): void {
    this.document = document as OpenApiDocument;
  }

  /** Especificação OpenAPI completa. */
  spec(): OpenApiDocument {
    if (!this.document) {
      throw new ServiceUnavailableException(
        'A especificação OpenAPI ainda não foi montada neste processo.',
      );
    }
    return this.document;
  }

  /**
   * Sumário navegável: o que existe, agrupado por área.
   *
   * Serve à tela de administração, que precisa listar as integrações possíveis
   * sem baixar um JSON de centenas de kB a cada abertura.
   */
  summary() {
    const document = this.spec();
    const endpoints: { method: string; path: string; summary?: string; tags: string[] }[] = [];

    for (const [path, operations] of Object.entries(document.paths ?? {})) {
      for (const [method, operation] of Object.entries(operations)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        endpoints.push({
          method: method.toUpperCase(),
          path,
          summary: operation.summary,
          tags: operation.tags ?? [],
        });
      }
    }

    const byTag = new Map<string, number>();
    for (const endpoint of endpoints) {
      for (const tag of endpoint.tags.length > 0 ? endpoint.tags : ['(sem área)']) {
        byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
      }
    }

    return {
      title: document.info?.title,
      version: document.info?.version,
      openapi: document.openapi,
      totalEndpoints: endpoints.length,
      totalSchemas: Object.keys(document.components?.schemas ?? {}).length,
      areas: [...byTag.entries()]
        .map(([tag, total]) => ({ tag, total }))
        .sort((a, b) => a.tag.localeCompare(b.tag)),
      endpoints: endpoints.sort(
        (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
      ),
    };
  }
}
