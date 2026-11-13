import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { layout } from '../layout';

interface PageHeaderProps {
  title: string;
  /** Muted text on the title's baseline: a count or a one-line description. */
  meta?: ReactNode;
  /** Small orange line above the title, e.g. a date. */
  overline?: ReactNode;
  /** Controls pushed to the right on wide screens. */
  actions?: ReactNode;
}

export function PageHeader({ title, meta, overline, actions }: PageHeaderProps) {
  return (
    <Box
      component="header"
      sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 2, rowGap: 0.5 }}
    >
      {overline && (
        <Typography
          variant="overline"
          sx={{ width: '100%', color: 'primary.main', letterSpacing: 2, lineHeight: 1.6 }}
        >
          {overline}
        </Typography>
      )}
      <Typography component="h1" sx={{ fontSize: layout.pageTitleSize, fontWeight: 400, lineHeight: 1.2 }}>
        {title}
      </Typography>
      {meta && (
        <Typography variant="body2" sx={{ color: 'text.secondary', minWidth: 0 }}>
          {meta}
        </Typography>
      )}
      {actions && <Box sx={{ ml: 'auto' }}>{actions}</Box>}
    </Box>
  );
}
