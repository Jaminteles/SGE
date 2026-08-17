import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Aprovação do pedido (RF-038). */
export class ApprovePurchaseOrderDto {
  @ApiPropertyOptional({ description: 'Observação da decisão' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  note?: string;
}

/** Reprovação e cancelamento exigem motivo: decisão sem razão não é auditável. */
export class RejectPurchaseOrderDto {
  @ApiProperty({ description: 'Motivo da reprovação' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}

export class CancelPurchaseOrderDto {
  @ApiProperty({ description: 'Motivo do cancelamento' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Transform(trim)
  reason!: string;
}
