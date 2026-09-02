import { Button } from './Button';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/** Rodapé de paginação: "1–4 de 148 · página 1 de 37" (UI-006). */
export function Pagination({ page, pageSize, total, totalPages, onPageChange }: PaginationProps) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const pages = Math.max(totalPages, 1);

  return (
    <nav className="pagination" aria-label="Paginação">
      <span>
        {first}–{last} de {total}
      </span>
      <span className="pagination__spacer" />
      <Button
        variant="secondary"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Página anterior"
      >
        ‹
      </Button>
      <span>
        página {page} de {pages}
      </span>
      <Button
        variant="secondary"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pages}
        aria-label="Próxima página"
      >
        ›
      </Button>
    </nav>
  );
}
