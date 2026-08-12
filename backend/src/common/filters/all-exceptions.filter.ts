import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

/**
 * Erro do PostgreSQL como o Prisma o repassa quando não tem código próprio
 * para ele — o texto do driver traz o SQLSTATE e a mensagem original.
 */
const POSTGRES_ERROR = /PostgresError \{ code: "(?<code>[^"]+)", message: "(?<message>[^"]*)"/;

/** `RAISE EXCEPTION` nas funções de `bd/*.sql`. */
const RAISE_EXCEPTION = 'P0001';
/** Violação de CHECK. */
const CHECK_VIOLATION = '23514';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
  correlationId?: string;
}

/**
 * Tratamento padronizado de erros (ERS §10). Mapeia exceções do Prisma para
 * códigos HTTP adequados e nunca vaza detalhes internos em produção.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();

    const { status, error, message } = this.resolve(exception);

    const body: ErrorBody = {
      statusCode: status,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
      correlationId: request.id,
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    error: string;
    message: string | string[];
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : ((res as { message?: string | string[] }).message ?? exception.message);
      return { status, error: exception.name, message };
    }

    // Antes do mapeamento por código do Prisma: uma regra de negócio recusada
    // pelo banco é erro de quem chamou, e o Prisma não tem código próprio para
    // ela — sem isto, um ciclo de hierarquia ou um papel incompatível viraria
    // 500, escondendo do cliente o que ele precisa corrigir.
    const rule = this.resolveDatabaseRule(exception);
    if (rule) {
      return rule;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.resolvePrisma(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'InternalServerError',
      message: 'Erro interno do servidor.',
    };
  }

  /**
   * Regras implementadas no banco (`bd/06`, `bd/07`) falam com o usuário: as
   * mensagens de `RAISE EXCEPTION` são escritas nos scripts para explicar o que
   * foi recusado — hierarquia com ciclo, papel incompatível, evento imutável.
   *
   * Violação de CHECK responde genérico de propósito: o texto do PostgreSQL cita
   * a relação e a restrição, e é detalhe interno. Os services validam essas
   * mesmas regras antes de escrever; aqui é a rede de segurança.
   *
   * Fora desta lista o erro do banco continua 500 — inclusive `42501` (RLS), que
   * significa a aplicação tentando escrever fora do escopo da empresa: é defeito
   * do servidor, e mascará-lo como 4xx atrasaria o diagnóstico.
   */
  private resolveDatabaseRule(
    exception: unknown,
  ): { status: number; error: string; message: string } | null {
    const isPrismaError =
      exception instanceof Prisma.PrismaClientKnownRequestError ||
      exception instanceof Prisma.PrismaClientUnknownRequestError;
    if (!isPrismaError) {
      return null;
    }

    const groups = POSTGRES_ERROR.exec(exception.message)?.groups;
    if (groups?.code === RAISE_EXCEPTION) {
      return { status: HttpStatus.BAD_REQUEST, error: 'BadRequest', message: groups.message };
    }
    if (groups?.code === CHECK_VIOLATION) {
      return {
        status: HttpStatus.BAD_REQUEST,
        error: 'BadRequest',
        message: 'Requisição viola uma regra de consistência do cadastro.',
      };
    }
    return null;
  }

  private resolvePrisma(exception: Prisma.PrismaClientKnownRequestError): {
    status: number;
    error: string;
    message: string;
  } {
    switch (exception.code) {
      case 'P2002': {
        const target = (exception.meta?.target as string[] | undefined)?.join(', ');
        return {
          status: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: target ? `Registro já existe (${target}).` : 'Registro já existe.',
        };
      }
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          error: 'NotFound',
          message: 'Registro não encontrado.',
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          error: 'BadRequest',
          message: 'Referência inválida para registro relacionado.',
        };
      default:
        return {
          status: HttpStatus.BAD_REQUEST,
          error: 'BadRequest',
          message: 'Requisição inválida.',
        };
    }
  }
}
