import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Descarte do documento (RF-049).
 *
 * O registro não é apagado — a role da aplicação não tem DELETE sobre
 * `documento_fiscal` (bd/12). O motivo é obrigatório porque "por que esta nota
 * foi descartada" é a única pergunta que sobra depois.
 */
export class CancelFiscalDocumentDto {
  @ApiProperty({ description: 'Motivo do descarte' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}
