import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaymentMethodsService } from './payment-methods.service';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';

@ApiTags('Parceiros — Formas de pagamento')
@ApiBearerAuth()
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly methods: PaymentMethodsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.PAYMENT_METHODS_CREATE)
  @ApiOperation({ summary: 'Cadastrar forma de pagamento (RF-026)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreatePaymentMethodDto) {
    return this.methods.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PAYMENT_METHODS_READ)
  @ApiOperation({ summary: 'Listar formas de pagamento (paginado)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.methods.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PAYMENT_METHODS_READ)
  @ApiOperation({ summary: 'Detalhar forma de pagamento' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.methods.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PAYMENT_METHODS_UPDATE)
  @ApiOperation({ summary: 'Editar forma de pagamento' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentMethodDto,
  ) {
    return this.methods.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PAYMENT_METHODS_DELETE)
  @ApiOperation({ summary: 'Inativar forma de pagamento' })
  remove(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.methods.remove(companyId, id);
  }
}
