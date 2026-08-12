import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaymentTermsService } from './payment-terms.service';
import { CreatePaymentTermDto } from './dto/create-payment-term.dto';
import { UpdatePaymentTermDto } from './dto/update-payment-term.dto';

@ApiTags('Parceiros — Condições de pagamento')
@ApiBearerAuth()
@Controller('payment-terms')
export class PaymentTermsController {
  constructor(private readonly terms: PaymentTermsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.PAYMENT_TERMS_CREATE)
  @ApiOperation({ summary: 'Cadastrar condição de pagamento (RF-026)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreatePaymentTermDto) {
    return this.terms.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PAYMENT_TERMS_READ)
  @ApiOperation({ summary: 'Listar condições de pagamento (paginado)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.terms.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PAYMENT_TERMS_READ)
  @ApiOperation({ summary: 'Detalhar condição de pagamento' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.terms.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PAYMENT_TERMS_UPDATE)
  @ApiOperation({ summary: 'Editar condição de pagamento' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentTermDto,
  ) {
    return this.terms.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PAYMENT_TERMS_DELETE)
  @ApiOperation({ summary: 'Inativar condição de pagamento' })
  remove(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.terms.remove(companyId, id);
  }
}
