import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  /** Alinha à direita e usa tabular-nums (valores monetários). */
  numeric?: boolean;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  loading?: boolean;
  emptyMessage?: string;
}

/**
 * Tabela de listagem (UI-006). A paginação é server-side: este componente só
 * desenha a página recebida — nunca ordena nem fatia a coleção inteira.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  loading = false,
  emptyMessage = 'Nenhum registro encontrado.',
}: DataTableProps<T>) {
  return (
    <div className="data-table__wrapper">
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.numeric ? 'th--numeric' : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td className="data-table__empty" colSpan={columns.length}>
                Carregando…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td className="data-table__empty" colSpan={columns.length}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key} className={column.numeric ? 'td--numeric' : undefined}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
