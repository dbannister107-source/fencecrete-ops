import * as React from 'react';
import { cn } from '../../lib/utils';

// Brand-defined status palette. Using inline style on the swatch so that
// Tailwind's JIT can't prune the rarely-used tokens, and so callers can
// pass an unknown status string without blowing up.
const STATUS_COLORS = {
  'Contract Review':   { bg: '#E5E7EB', fg: '#374151', ring: '#9CA3AF' },
  'Production Queue':  { bg: '#FEF3C7', fg: '#92400E', ring: '#D97706' },
  'In Production':     { bg: '#EDE9FE', fg: '#5B21B6', ring: '#7C3AED' },
  'Material Ready':    { bg: '#DBEAFE', fg: '#1E40AF', ring: '#2563EB' },
  'Active Install':    { bg: '#D1FAE5', fg: '#065F46', ring: '#059669' },
  'Fence Complete':    { bg: '#CCFBF1', fg: '#115E59', ring: '#0D9488' },
  'Fully Complete':    { bg: '#D1FAE5', fg: '#064E3B', ring: '#10B981' },
  'Closed':            { bg: '#E5E7EB', fg: '#374151', ring: '#9CA3AF' },
  'Canceled':          { bg: '#FEE2E2', fg: '#991B1B', ring: '#DC2626' },
};

const FALLBACK = { bg: '#E5E7EB', fg: '#374151', ring: '#9CA3AF' };

export function StatusBadge({ status, className, ...props }) {
  const c = STATUS_COLORS[status] || FALLBACK;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border',
        className
      )}
      style={{ backgroundColor: c.bg, color: c.fg, borderColor: c.ring }}
      {...props}
    >
      {status || '—'}
    </span>
  );
}

export { STATUS_COLORS };
