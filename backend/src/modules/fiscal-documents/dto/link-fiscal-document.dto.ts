import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { MAX_ITEMS_PER_DOCUMENT } from '../fiscal-documents.constants';

/** Item da nota associado a um item do catálogo (RF-047). */
export class LinkFiscalDocumentItemDto {
  @ApiPropertyOptional({ description: 'Item do documento fiscal' })
  @IsUUID()
  itemId!: string;

  @ApiPropertyOptional({
    description: 'Produto do catálogo. Nulo desfaz o vínculo enquanto a nota não deu entrada.',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  productId?: string | null;
}

/**
 * Vínculos do documento (RF-047).
 *
 * Só vínculos: nada aqui altera o conteúdo fiscal da nota, que é imutável
 * (bd/12). Campo ausente é "não mexer"; `null` desfaz o vínculo.
 */
export class LinkFiscalDocumentDto {
  @ApiPropertyOptional({ description: 'Fornecedor emitente', nullable: true })
  @IsOptional()
  @IsUUID()
  issuerPartnerId?: string | null;

  @ApiPropertyOptional({ description: 'Pedido de compra faturado pela nota', nullable: true })
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string | null;

  @ApiPropertyOptional({ description: 'Filial de destino', nullable: true })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional({ type: [LinkFiscalDocumentItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS_PER_DOCUMENT)
  @ValidateNested({ each: true })
  @Type(() => LinkFiscalDocumentItemDto)
  items?: LinkFiscalDocumentItemDto[];
}
