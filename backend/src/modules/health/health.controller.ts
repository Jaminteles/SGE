import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Verificação de saúde da API e do banco' })
  async check() {
    let database = 'up';
    let schema: string | null = null;
    try {
      // Confirma também que a conexão enxerga o schema `gestao` (search_path).
      const [row] = await this.prisma.db.$queryRaw<{ schema: string }[]>`
        SELECT current_schema() AS schema
      `;
      schema = row?.schema ?? null;
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' && schema === 'gestao' ? 'ok' : 'degraded',
      database,
      schema,
      timestamp: new Date().toISOString(),
    };
  }
}
