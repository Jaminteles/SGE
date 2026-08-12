import { PartialType } from '@nestjs/swagger';
import { CreatePartnerAddressDto } from './create-partner-address.dto';

export class UpdatePartnerAddressDto extends PartialType(CreatePartnerAddressDto) {}
