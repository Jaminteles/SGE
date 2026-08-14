import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { IsDateOnly } from '../../../common/utils/date-only';
import { IsMoney } from '../../../common/validators/decimal.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Edição do título (RF-051/RF-054).
 *
 * `type`, `number`, `partnerId` e `employeeId` não estão aqui: mudar a carteira
 * ou a contraparte de um título já emitido é emitir outro título. Os valores só
 * são aceitos enquanto nada foi liquidado — e nesse caso o service refaz as
 * parcelas, porque elas precisam continuar somando o valor líquido (RF-053).
 */
export class UpdateFinancialEntryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(trim)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  documentReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateOnly()
  competenceDate?: string;

  @ApiPropertyOptional({ description: 'Só é aceito enquanto o título não tem baixa' })
  @IsOptional()
  @IsMoney()
  grossAmount?: string;

  @ApiPropertyOptional({ description: 'Só é aceito enquanto o título não tem baixa' })
  @IsOptional()
  @IsMoney()
  discountAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  paymentMethodId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  note?: string;
}
