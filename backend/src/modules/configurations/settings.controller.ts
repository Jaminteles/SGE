import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SettingScope } from '../../common/enums';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { SettingsService } from './settings.service';
import { UpsertSettingDto } from './dto/upsert-setting.dto';

@ApiTags('Parâmetros da Empresa')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: 'Listar parâmetros financeiros e fiscais (RF-006)' })
  @ApiQuery({ name: 'scope', enum: SettingScope, required: false })
  findAll(@ActiveCompanyId() companyId: string, @Query('scope') scope?: SettingScope) {
    return this.settings.findAll(companyId, scope);
  }

  @Put()
  @RequirePermissions(PERMISSIONS.SETTINGS_UPDATE)
  @ApiOperation({ summary: 'Definir/atualizar parâmetro (RF-006)' })
  upsert(@ActiveCompanyId() companyId: string, @Body() dto: UpsertSettingDto) {
    return this.settings.upsert(companyId, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.SETTINGS_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover parâmetro (RF-006)' })
  remove(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.settings.remove(companyId, id);
  }
}
