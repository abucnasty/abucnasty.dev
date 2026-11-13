import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import { layout } from '../layout';

interface ListRowProps {
  /** Fixed slot at the left: an icon, a thumbnail or a date. */
  lead?: ReactNode;
  title: ReactNode;
  /** Muted second line. Its presence makes this a two-line row. */
  subtitle?: ReactNode;
  /** Right-hand slot: chips, numbers, action buttons. Never shrinks. */
  trailing?: ReactNode;
  /** Whole row is a router link. Don't put other links or buttons in `trailing` when set. */
  to?: string;
  /** Whole row is an external link, opened in a new tab. */
  href?: string;
  /** Let title and subtitle wrap instead of truncating with an ellipsis. */
  wrap?: boolean;
  /** Render at 55% opacity (deprecated entries). */
  dimmed?: boolean;
  sx?: SxProps<Theme>;
}

const truncate = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

export function ListRow({ lead, title, subtitle, trailing, to, href, wrap, dimmed, sx }: ListRowProps) {
  const linkProps = to
    ? { component: RouterLink, to }
    : href
      ? { component: 'a', href, target: '_blank', rel: 'noopener noreferrer' }
      : {};

  return (
    <Box
      data-row
      {...linkProps}
      sx={[
        {
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: 1.25,
          py: 0.5,
          minHeight: { xs: layout.touchTarget, md: subtitle ? layout.rowHeightTwoLine : layout.rowHeight },
          borderBottom: 1,
          borderColor: 'divider',
          fontSize: 14,
          color: 'text.primary',
          textDecoration: 'none',
          opacity: dimmed ? 0.55 : 1,
          transition: 'background-color 120ms',
          '&:hover': { backgroundColor: 'action.hover' },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {lead && <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{lead}</Box>}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ fontWeight: 600, ...(wrap ? { overflowWrap: 'anywhere' } : truncate) }}>{title}</Box>
        {subtitle && (
          <Box sx={{ fontSize: 12.5, color: 'text.secondary', ...(wrap ? { overflowWrap: 'anywhere' } : truncate) }}>
            {subtitle}
          </Box>
        )}
      </Box>
      {trailing && <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 1 }}>{trailing}</Box>}
    </Box>
  );
}

export function RowGroup({ children }: { children: ReactNode }) {
  return <Box sx={{ backgroundColor: 'background.paper', borderTop: 1, borderColor: 'divider' }}>{children}</Box>;
}
