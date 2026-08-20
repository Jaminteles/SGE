import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const CREDENTIAL_ENVIRONMENTS = ['SANDBOX', 'PRODUCAO'] as const;

/**
 * Credencial de integração (RF-061, RNF-003/RNF-005).
 *
 * `secret` entra e nunca sai: é cifrado com AES-256-GCM antes de tocar o banco,
 * e não há endpoint que o devolva — nem mascarado. Perdeu, cadastra de novo.
 *
 * O conteúdo é livre porque cada provedor pede o seu, mas as chaves que o
 * adaptador HTTP entende são `baseUrl`, `apiKey`, `clientId` e `webhookSecret`.
 */
export class CreateCredentialDto {
  @ApiProperty({ description: 'Provedor do catálogo (GET /banking/providers)' })
  @IsUUID()
  providerId!: string;

  @ApiProperty({ description: 'Nome da credencial, para distinguir várias do mesmo provedor' })
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional({ enum: CREDENTIAL_ENVIRONMENTS, default: 'PRODUCAO' })
  @IsOptional()
  @IsIn(CREDENTIAL_ENVIRONMENTS)
  environment?: (typeof CREDENTIAL_ENVIRONMENTS)[number];

  @ApiProperty({
    description: 'Segredo do provedor. Cifrado no servidor; nunca é devolvido pela API.',
    example: { baseUrl: 'https://api.banco.example', apiKey: '...', webhookSecret: '...' },
  })
  @IsObject()
  secret!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Referência do certificado no cofre, quando houver' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(trim)
  certificateRef?: string;

  @ApiPropertyOptional({ description: 'Validade da credencial (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
