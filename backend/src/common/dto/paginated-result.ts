import { ApiProperty } from '@nestjs/swagger';

/** Envelope padrão de respostas paginadas (RNF-008). */
export class PaginatedResult<T> {
  @ApiProperty({ isArray: true })
  data: T[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  totalPages: number;

  constructor(data: T[], total: number, page: number, pageSize: number) {
    this.data = data;
    this.total = total;
    this.page = page;
    this.pageSize = pageSize;
    this.totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  }
}
