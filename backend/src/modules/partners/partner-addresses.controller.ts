import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PartnerAddressesService } from './partner-addresses.service';
import { CreatePartnerAddressDto } from './dto/create-partner-address.dto';
import { UpdatePartnerAddressDto } from './dto/update-partner-address.dto';

@ApiTags('Parceiros — Endereços')
@ApiBearerAuth()
@Controller('partners/:partnerId/addresses')
export class PartnerAddressesController {
  constructor(private readonly addresses: PartnerAddressesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.PARTNER_CONTACTS_CREATE)
  @ApiOperation({ summary: 'Cadastrar endereço do parceiro (RF-024)' })
  create(
    @ActiveCompanyId() companyId: string,
    @Param('partnerId') partnerId: string,
    @Body() dto: CreatePartnerAddressDto,
  ) {
    return this.addresses.create(companyId, partnerId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PARTNER_CONTACTS_READ)
  @ApiOperation({ summary: 'Listar endereços do parceiro' })
  findAll(@ActiveCompanyId() companyId: string, @Param('partnerId') partnerId: string) {
    return this.addresses.findAll(companyId, partnerId);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PARTNER_CONTACTS_UPDATE)
  @ApiOperation({ summary: 'Editar endereço do parceiro' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('partnerId') partnerId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePartnerAddressDto,
  ) {
    return this.addresses.update(companyId, partnerId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.PARTNER_CONTACTS_DELETE)
  @ApiOperation({ summary: 'Remover endereço do parceiro' })
  remove(
    @ActiveCompanyId() companyId: string,
    @Param('partnerId') partnerId: string,
    @Param('id') id: string,
  ) {
    return this.addresses.remove(companyId, partnerId, id);
  }
}
