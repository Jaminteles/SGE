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
import { PartnerContactsService } from './partner-contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

@ApiTags('Parceiros — Contatos')
@ApiBearerAuth()
@Controller('partners/:partnerId/contacts')
export class PartnerContactsController {
  constructor(private readonly contacts: PartnerContactsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.PARTNER_CONTACTS_CREATE)
  @ApiOperation({ summary: 'Cadastrar contato do parceiro (RF-024)' })
  create(
    @ActiveCompanyId() companyId: string,
    @Param('partnerId') partnerId: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.contacts.create(companyId, partnerId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PARTNER_CONTACTS_READ)
  @ApiOperation({ summary: 'Listar contatos do parceiro' })
  findAll(@ActiveCompanyId() companyId: string, @Param('partnerId') partnerId: string) {
    return this.contacts.findAll(companyId, partnerId);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PARTNER_CONTACTS_UPDATE)
  @ApiOperation({ summary: 'Editar contato do parceiro' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('partnerId') partnerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contacts.update(companyId, partnerId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.PARTNER_CONTACTS_DELETE)
  @ApiOperation({ summary: 'Remover contato do parceiro' })
  remove(
    @ActiveCompanyId() companyId: string,
    @Param('partnerId') partnerId: string,
    @Param('id') id: string,
  ) {
    return this.contacts.remove(companyId, partnerId, id);
  }
}
