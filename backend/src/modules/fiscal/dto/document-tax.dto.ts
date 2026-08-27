import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { MAX_ITEMS_PER_DOCUMENT } from '../../fiscal-documents/fiscal-documents.constants';

/**
 * Classificação de uma linha da nota (RF-090).
 *
 * Liga o item ao NCM cadastrado pela empresa. **Não** altera nada do que o
 * emitente declarou: valor, base, alíquota e o próprio NCM do XML seguem
 * intactos (bd/18 §4). `classificationId` nulo desfaz o vínculo.
 */
export class ClassifyDocumentItemDto {
  @ApiProperty({ minimum: 1, maximum: MAX_ITEMS_PER_DOCUMENT })
  @Transform(({ value }) => (value === undefined ? value : parseInt(value as string, 10)))
  @IsInt()
  @Min(1)
  sequence!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Classificação de NCM da empresa. `null` remove o vínculo.',
  })
  @IsOptional()
  @IsUUID()
  classificationId?: string | null;
}
