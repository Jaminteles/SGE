import { Global, Module } from '@nestjs/common';
import { ReferencesService } from './references.service';

/**
 * Global: a validação de referência por empresa é transversal aos módulos de
 * cadastro (M03, M04, M05) e não deve ser reimplementada em cada um.
 */
@Global()
@Module({
  providers: [ReferencesService],
  exports: [ReferencesService],
})
export class ReferencesModule {}
