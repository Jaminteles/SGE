import { ServiceUnavailableException } from '@nestjs/common';
import { ApiDocsService } from './api-docs.service';

const document = {
  openapi: '3.0.0',
  info: { title: 'SGE API', version: '1.0' },
  paths: {
    '/api/v1/integrations': {
      get: { summary: 'Listar integrações', tags: ['M18'] },
      post: { summary: 'Cadastrar integração', tags: ['M18'] },
      parameters: [],
    },
    '/api/v1/health': { get: { summary: 'Health', tags: ['Infra'] } },
  },
  components: { schemas: { CreateIntegrationDto: {} } },
};

describe('ApiDocsService', () => {
  it('recusa servir a especificação antes de o boot montá-la', () => {
    expect(() => new ApiDocsService().spec()).toThrow(ServiceUnavailableException);
  });

  it('resume os endpoints por área, ignorando o que não é operação HTTP', () => {
    const service = new ApiDocsService();
    service.set(document);

    const summary = service.summary();

    // `parameters` está sob o path mas não é um método: contá-lo inflaria o
    // total e criaria uma "área" inexistente.
    expect(summary.totalEndpoints).toBe(3);
    expect(summary.totalSchemas).toBe(1);
    expect(summary.areas).toEqual([
      { tag: 'Infra', total: 1 },
      { tag: 'M18', total: 2 },
    ]);
  });
});
