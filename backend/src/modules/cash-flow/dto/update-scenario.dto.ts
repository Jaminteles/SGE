import { PartialType } from '@nestjs/swagger';
import { CreateScenarioDto } from './create-scenario.dto';

/**
 * Edição do cenário (RF-104).
 *
 * Tudo é editável: cenário é rascunho de planejamento, não fato contábil.
 * Encurtar a janela para fora de uma projeção manual já lançada é recusado pelo
 * serviço — as linhas ficariam pendentes num período que o cenário não cobre.
 */
export class UpdateScenarioDto extends PartialType(CreateScenarioDto) {}
