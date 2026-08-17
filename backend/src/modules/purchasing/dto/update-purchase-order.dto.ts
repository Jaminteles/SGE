import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsOptional, ValidateNested } from 'class-validator';
import { PartialType, OmitType } from '@nestjs/swagger';
import { CreatePurchaseOrderDto, PurchaseOrderItemDto } from './create-purchase-order.dto';

/**
 * Edição do pedido (RF-036/RF-037) — só em rascunho, e o banco também recusa o
 * contrário (bd/11): aprovar um pedido cujos itens ainda podem mudar não é
 * aprovar nada.
 *
 * `items`, quando informado, **substitui** a lista inteira: manter um patch por
 * linha exigiria identificar cada item pelo id, e a lista curta de um rascunho
 * não paga esse contrato.
 */
export class UpdatePurchaseOrderDto extends PartialType(
  OmitType(CreatePurchaseOrderDto, ['items'] as const),
) {
  @ApiPropertyOptional({ type: [PurchaseOrderItemDto], description: 'Substitui todos os itens' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items?: PurchaseOrderItemDto[];
}
