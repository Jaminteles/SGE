import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { CLASSIFIABLE_SOURCES, ClassifiableSource } from './accounting.constants';

/**
 * Valida a origem classificável vinda da URL (RF-080).
 *
 * O path param escolhe qual tabela o serviço lê e escreve. Sem esta barreira, o
 * valor da URL chegaria a um `switch` como string livre — e o dia em que alguém
 * trocar o `switch` por um índice de nomes de model, a rota vira acesso a
 * qualquer tabela do schema. A lista fechada é o que impede isso de ser
 * possível, hoje e depois.
 */
@Injectable()
export class ParseClassifiableSourcePipe implements PipeTransform<string, ClassifiableSource> {
  transform(value: string): ClassifiableSource {
    if ((CLASSIFIABLE_SOURCES as readonly string[]).includes(value)) {
      return value as ClassifiableSource;
    }
    throw new BadRequestException(
      `Origem inválida. Use uma de: ${CLASSIFIABLE_SOURCES.join(', ')}.`,
    );
  }
}
