import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Cancelamento de inventário (RF-033).
 *
 * O motivo é obrigatório: uma contagem abandonada sem explicação é
 * indistinguível de uma contagem descartada por conveniência.
 */
export class CancelInventoryDto {
  @ApiProperty({ description: 'Motivo do cancelamento' })
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  reason!: string;
}
