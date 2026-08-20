import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** Filtros das contas bancárias (RF-059). `q` busca descrição, banco e conta. */
export class QueryCompanyAccountDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Somente contas habilitadas a pagar' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  allowsPayment?: boolean;

  @ApiPropertyOptional({ description: 'Somente contas habilitadas a receber' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  allowsReceipt?: boolean;
}
