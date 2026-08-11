import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsCpf } from '../../../common/validators/is-cpf.validator';
import { onlyDigits } from '../../../common/validators/is-cnpj.validator';
import { IsMoney } from '../../../common/validators/decimal.decorator';
import { IsDateOnly } from '../../../common/utils/date-only';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const digits = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? onlyDigits(value) : value;

/** Tipos de contrato aceitos em `funcionario.tipo_contrato` (varchar livre no banco). */
export const CONTRACT_TYPES = ['CLT', 'PJ', 'ESTAGIO', 'TEMPORARIO', 'APRENDIZ'] as const;

/** Funcionário (RF-013, RF-016) — `gestao.funcionario`. */
export class CreateEmployeeDto {
  @ApiProperty({ description: 'Matrícula única na empresa' })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  @Transform(trim)
  registration!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  @Transform(trim)
  name!: string;

  @ApiProperty({ description: 'CPF (somente dígitos ou formatado)' })
  @Transform(digits)
  @IsCpf()
  taxId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trim)
  rg?: string;

  @ApiPropertyOptional({ description: 'PIS/PASEP (somente dígitos)' })
  @IsOptional()
  @Transform(digits)
  @Matches(/^\d{11,15}$/, { message: 'pis deve conter de 11 a 15 dígitos' })
  pis?: string;

  @ApiPropertyOptional({ description: 'Data de nascimento (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateOnly()
  birthDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  corporateEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trim)
  phone?: string;

  @ApiPropertyOptional({ description: 'Cargo (RF-014)' })
  @IsOptional()
  @IsUUID()
  positionId?: string;

  @ApiPropertyOptional({ description: 'Departamento (RF-014)' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Centro de custo de apropriação (RF-016)' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;

  @ApiPropertyOptional({ description: 'Gestor imediato (RF-014)' })
  @IsOptional()
  @IsUUID()
  managerId?: string;

  @ApiPropertyOptional({ description: 'Filial de lotação' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Usuário do sistema correspondente, se houver' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiProperty({ description: 'Data de admissão (YYYY-MM-DD) — RF-015' })
  @IsDateOnly()
  hireDate!: string;

  @ApiPropertyOptional({ enum: CONTRACT_TYPES })
  @IsOptional()
  @IsIn(CONTRACT_TYPES)
  contractType?: (typeof CONTRACT_TYPES)[number];

  @ApiPropertyOptional({ description: 'Salário base na admissão (decimal) — RF-017' })
  @IsOptional()
  @IsMoney()
  baseSalary?: string;
}
