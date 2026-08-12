import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface CapturedBody {
  statusCode: number;
  error: string;
  message: string | string[];
}

function buildHost() {
  let captured: CapturedBody | undefined;
  let statusCode = 0;

  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: CapturedBody) {
      captured = body;
    },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: '/api/v1/product-categories/abc', method: 'PATCH', id: 'corr-1' }),
    }),
  } as unknown as ArgumentsHost;

  return { host, result: () => ({ statusCode, body: captured! }) };
}

/** Erro como o Prisma o repassa quando o PostgreSQL levanta a exceção. */
function postgresError(code: string, message: string) {
  return new Prisma.PrismaClientUnknownRequestError(
    `Invalid \`prisma.productCategory.update()\` invocation:\n\n` +
      `ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(` +
      `PostgresError { code: "${code}", message: "${message}", severity: "ERRO" }), transient: false })`,
    { clientVersion: '6.2.0' },
  );
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('preserva status e mensagem de HttpException', () => {
    const { host, result } = buildHost();

    filter.catch(new BadRequestException('Campo inválido.'), host);

    expect(result().statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(result().body.message).toBe('Campo inválido.');
  });

  // As regras de bd/06 e bd/07 são recusas ao chamador, com mensagem escrita
  // para ele — devolvê-las como 500 esconderia o que precisa ser corrigido.
  it('traduz RAISE EXCEPTION do banco em 400 com a mensagem da regra', () => {
    const { host, result } = buildHost();

    filter.catch(
      postgresError(
        'P0001',
        'Hierarquia invalida em categoria_produto: a alteracao cria um ciclo.',
      ),
      host,
    );

    expect(result().statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(result().body.message).toBe(
      'Hierarquia invalida em categoria_produto: a alteracao cria um ciclo.',
    );
  });

  it('traduz violação de CHECK em 400 sem expor relação e restrição', () => {
    const { host, result } = buildHost();

    filter.catch(
      postgresError(
        '23514',
        'a nova linha da relação "produto" viola a restrição "ck_produto_fiscal"',
      ),
      host,
    );

    expect(result().statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(result().body.message).toBe('Requisição viola uma regra de consistência do cadastro.');
  });

  // 42501 é a RLS recusando escrita fora da empresa ativa: defeito do servidor,
  // não do cliente. Mascarar como 4xx atrasaria o diagnóstico.
  it('mantém violação de RLS como erro do servidor', () => {
    const { host, result } = buildHost();

    filter.catch(
      postgresError('42501', 'a nova linha viola a política de segurança no nível de linha'),
      host,
    );

    expect(result().statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(result().body.message).toBe('Erro interno do servidor.');
  });

  it('mapeia violação de unicidade do Prisma em 409', () => {
    const { host, result } = buildHost();

    filter.catch(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: '6.2.0',
        meta: { target: ['empresa_id', 'codigo'] },
      }),
      host,
    );

    expect(result().statusCode).toBe(HttpStatus.CONFLICT);
  });

  it('não vaza detalhe interno de erro desconhecido', () => {
    const { host, result } = buildHost();

    filter.catch(new Error('connection string: postgres://user:senha@host'), host);

    expect(result().statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(result().body.message).toBe('Erro interno do servidor.');
  });
});
