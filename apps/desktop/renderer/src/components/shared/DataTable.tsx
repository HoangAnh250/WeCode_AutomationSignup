import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from './EmptyState';
export interface Column<T> {
  key: string;
  label: ReactNode;
  render: (row: T, index: number) => ReactNode;
  sortValue?: (row: T) => string | number;
  className?: string;
}
export function DataTable<T extends { id: string }>({
  rows,
  columns,
  label,
  pageSize = 8,
  numberedPages = false,
}: {
  rows: T[];
  columns: Column<T>[];
  label: string;
  pageSize?: number;
  numberedPages?: boolean;
}) {
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const col = columns.find((c) => c.key === sort?.key);
  const ordered = col?.sortValue
    ? [...rows].sort((a, b) => {
        const av = col.sortValue!(a),
          bv = col.sortValue!(b);
        return (
          (typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av).localeCompare(String(bv))) * (sort?.desc ? -1 : 1)
        );
      })
    : rows;
  const actual = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageNumbers = [
    ...new Set([
      0,
      totalPages - 1,
      ...Array.from({ length: 5 }, (_, offset) => actual + offset - 2),
    ]),
  ]
    .filter((value) => value >= 0 && value < totalPages)
    .sort((a, b) => a - b);
  const visible = ordered.slice(actual * pageSize, (actual + 1) * pageSize);
  return (
    <div className="data-table">
      <div className="table-scroll">
        <table aria-label={label}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={c.className}
                  aria-sort={
                    sort?.key === c.key ? (sort.desc ? 'descending' : 'ascending') : undefined
                  }
                >
                  {c.sortValue ? (
                    <button
                      className="sort-header"
                      onClick={() =>
                        setSort((s) => ({ key: c.key, desc: s?.key === c.key ? !s.desc : false }))
                      }
                    >
                      {c.label}
                      <ArrowUpDown size={12} />
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr key={row.id}>
                {columns.map((c) => (
                  <td key={c.key} className={c.className}>
                    {c.render(row, actual * pageSize + index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && (
          <EmptyState title="No matching records" description="Try a different search or filter." />
        )}
      </div>
      <div className="table-footer">
        <span>
          {rows.length
            ? `Showing ${actual * pageSize + 1}-${Math.min((actual + 1) * pageSize, rows.length)} of ${rows.length} records`
            : '0 records'}
        </span>
        <div className="pagination">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Previous page"
            disabled={actual === 0}
            onClick={() => setPage(actual - 1)}
          >
            <ChevronLeft size={16} />
          </Button>
          {numberedPages &&
            pageNumbers.map((number, index) => (
              <span className="page-number-item" key={number}>
                {index > 0 && number - pageNumbers[index - 1] > 1 && (
                  <span aria-hidden="true">...</span>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Go to page ${number + 1}`}
                  aria-current={actual === number ? 'page' : undefined}
                  onClick={() => setPage(number)}
                >
                  {number + 1}
                </Button>
              </span>
            ))}
          {!numberedPages && (
            <span>
              {actual + 1} / {totalPages}
            </span>
          )}
          <Button
            size="icon"
            variant="ghost"
            aria-label="Next page"
            disabled={(actual + 1) * pageSize >= rows.length}
            onClick={() => setPage(actual + 1)}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}
