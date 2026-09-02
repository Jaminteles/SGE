import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { formatDecimal } from '../lib/decimal';
import { Badge } from './Badge';
import { DataTable, type Column } from './DataTable';
import { Pagination } from './Pagination';

interface Row {
  id: string;
  code: string;
  description: string;
  amount: string;
  status: string;
}

const rows: Row[] = [
  {
    id: '1',
    code: 'REG-0148',
    description: 'Registro de exemplo',
    amount: '12450.00',
    status: 'Ativo',
  },
  {
    id: '2',
    code: 'REG-0146',
    description: 'Registro de exemplo',
    amount: '870.00',
    status: 'Pendente',
  },
];

const columns: Column<Row>[] = [
  { key: 'code', header: 'Código', render: (row) => row.code },
  { key: 'description', header: 'Descrição', render: (row) => row.description },
  { key: 'amount', header: 'Valor', numeric: true, render: (row) => formatDecimal(row.amount) },
  {
    key: 'status',
    header: 'Situação',
    render: (row) => <Badge tone="success">{row.status}</Badge>,
  },
];

describe('DataTable', () => {
  it('desenha cabeçalhos e linhas da página recebida', () => {
    render(
      <DataTable caption="Registros" columns={columns} rows={rows} rowKey={(row) => row.id} />,
    );

    expect(screen.getByRole('columnheader', { name: 'Código' })).toBeInTheDocument();
    expect(screen.getByText('REG-0148')).toBeInTheDocument();
    expect(screen.getByText('12.450,00')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3); // cabeçalho + 2 linhas
  });

  it('mostra estado vazio e estado de carregamento', () => {
    const { rerender } = render(
      <DataTable caption="Registros" columns={columns} rows={[]} rowKey={(row) => row.id} />,
    );
    expect(screen.getByText('Nenhum registro encontrado.')).toBeInTheDocument();

    rerender(
      <DataTable
        caption="Registros"
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        loading
      />,
    );
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
  });
});

describe('Pagination', () => {
  it('mostra o intervalo e a página atual', () => {
    render(<Pagination page={1} pageSize={4} total={148} totalPages={37} onPageChange={vi.fn()} />);
    expect(screen.getByText('1–4 de 148')).toBeInTheDocument();
    expect(screen.getByText('página 1 de 37')).toBeInTheDocument();
  });

  it('desabilita "anterior" na primeira página e navega adiante', async () => {
    const onPageChange = vi.fn();
    render(
      <Pagination page={1} pageSize={4} total={148} totalPages={37} onPageChange={onPageChange} />,
    );

    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('desabilita "próxima" na última página', () => {
    render(
      <Pagination page={37} pageSize={4} total={148} totalPages={37} onPageChange={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Próxima página' })).toBeDisabled();
  });
});
