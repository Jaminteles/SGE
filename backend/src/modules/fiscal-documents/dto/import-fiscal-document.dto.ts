import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Campos que acompanham o XML no upload manual (RF-043/RF-044).
 *
 * Tudo o que descreve a nota — chave, emitente, itens, valores — vem do arquivo,
 * nunca do formulário: aceitar aqui o número ou o valor da nota abriria a porta
 * para um documento cujo conteúdo diverge do XML que o comprova.
 */
export class ImportFiscalDocumentDto {
  @ApiPropertyOptional({ description: 'Filial que recebeu o documento' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Observação interna sobre a importação' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;
}
