import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateProductSupplierDto } from './create-product-supplier.dto';

/** O fornecedor do vínculo não muda: trocá-lo é remover um e criar outro. */
export class UpdateProductSupplierDto extends PartialType(
  OmitType(CreateProductSupplierDto, ['partnerId']),
) {}
