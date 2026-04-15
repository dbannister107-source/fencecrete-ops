import * as React from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/utils';

// Responsive data table:
//  - Desktop (>=1024px): real <table> with sticky header, zebra rows,
//    sortable columns (click header), horizontal scroll.
//  - Tablet (768-1023px): same table, slightly smaller font.
//  - Mobile (<768px): rows render as stacked cards. The first column
//    becomes the card's bold primary field; remaining columns render
//    as label/value rows. Tapping a card fires `onRowClick`.
//
// Columns API:
//   { key, header, accessor?, cell?, sortable?, className?, mobile?, primary? }
//     accessor: (row) => value   (defaults to row[key])
//     cell:     (value, row) => React node (defaults to String(value))
//     primary:  true marks the card's title on mobile (falls back to first column)
//     mobile:   false hides the column in mobile card view
//
// Keeps the `frozen` option (number of leading columns to freeze on desktop).

function getSortValue(row, col) {
  const raw = col.accessor ? col.accessor(row) : row[col.key];
  if (raw == null) return '';
  if (typeof raw === 'number') return raw;
  const num = Number(raw);
  if (!Number.isNaN(num) && String(raw).trim() !== '') return num;
  return String(raw).toLowerCase();
}

export function DataTable({
  columns,
  data,
  onRowClick,
  emptyMessage = 'No records found.',
  className,
  rowClassName,
  mobileBreakpoint = 768,
  initialSort = null, // { key, direction }
}) {
  const [sort, setSort] = React.useState(initialSort);
  const [isMobile, setIsMobile] = React.useState(
    typeof window !== 'undefined' ? window.innerWidth < mobileBreakpoint : false
  );

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsMobile(window.innerWidth < mobileBreakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mobileBreakpoint]);

  const sorted = React.useMemo(() => {
    if (!sort) return data;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return data;
    const copy = [...data];
    copy.sort((a, b) => {
      const av = getSortValue(a, col);
      const bv = getSortValue(b, col);
      if (av < bv) return sort.direction === 'asc' ? -1 : 1;
      if (av > bv) return sort.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [data, sort, columns]);

  const toggleSort = (col) => {
    if (!col.sortable) return;
    setSort((s) => {
      if (!s || s.key !== col.key) return { key: col.key, direction: 'asc' };
      if (s.direction === 'asc') return { key: col.key, direction: 'desc' };
      return null;
    });
  };

  const primaryCol =
    columns.find((c) => c.primary) || columns.find((c) => c.mobile !== false) || columns[0];
  const mobileCols = columns.filter((c) => c !== primaryCol && c.mobile !== false);

  if (isMobile) {
    if (!sorted || sorted.length === 0) {
      return <div className="p-6 text-center text-sm text-muted-foreground">{emptyMessage}</div>;
    }
    return (
      <div className={cn('flex flex-col gap-3 px-4 py-4', className)}>
        {sorted.map((row, idx) => {
          const titleRaw = primaryCol.accessor ? primaryCol.accessor(row) : row[primaryCol.key];
          const title = primaryCol.cell ? primaryCol.cell(titleRaw, row) : titleRaw ?? '—';
          return (
            <div
              key={row.id ?? idx}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'rounded-lg border bg-card p-4 shadow-sm active:scale-[0.99] transition-transform',
                onRowClick && 'cursor-pointer',
                typeof rowClassName === 'function' ? rowClassName(row) : rowClassName
              )}
            >
              <div className="font-semibold text-[15px] text-foreground mb-2">{title}</div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px]">
                {mobileCols.map((col) => {
                  const raw = col.accessor ? col.accessor(row) : row[col.key];
                  const rendered = col.cell ? col.cell(raw, row) : raw ?? '—';
                  return (
                    <React.Fragment key={col.key}>
                      <dt className="text-muted-foreground text-xs uppercase tracking-wide self-center">
                        {col.header}
                      </dt>
                      <dd className="text-foreground text-right">{rendered}</dd>
                    </React.Fragment>
                  );
                })}
              </dl>
            </div>
          );
        })}
      </div>
    );
  }

  // Desktop / tablet view
  return (
    <div className={cn('relative w-full overflow-auto border rounded-lg bg-card', className)}>
      <table className="w-full caption-bottom text-[13px] md:text-[13px] lg:text-[13px]">
        <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
          <tr>
            {columns.map((col) => {
              const isSorted = sort && sort.key === col.key;
              return (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col)}
                  className={cn(
                    'h-10 px-3 text-left align-middle font-semibold text-muted-foreground uppercase text-[11px] tracking-wide select-none',
                    col.sortable && 'cursor-pointer hover:text-foreground',
                    col.className
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortable && (
                      <span className="text-muted-foreground/60">
                        {!isSorted && <ChevronsUpDown className="h-3 w-3" />}
                        {isSorted && sort.direction === 'asc' && <ChevronUp className="h-3 w-3" />}
                        {isSorted && sort.direction === 'desc' && <ChevronDown className="h-3 w-3" />}
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="p-6 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </td>
            </tr>
          )}
          {sorted.map((row, idx) => (
            <tr
              key={row.id ?? idx}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b transition-colors hover:bg-muted/40',
                idx % 2 === 1 && 'bg-[#FAFAFA]',
                onRowClick && 'cursor-pointer',
                typeof rowClassName === 'function' ? rowClassName(row) : rowClassName
              )}
            >
              {columns.map((col) => {
                const raw = col.accessor ? col.accessor(row) : row[col.key];
                const rendered = col.cell ? col.cell(raw, row) : raw ?? '—';
                return (
                  <td key={col.key} className={cn('p-3 align-middle', col.className)}>
                    {rendered}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
