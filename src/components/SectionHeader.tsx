import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

interface SectionHeaderProps {
  label: string;
  /** Muted text at the right: counts, totals. */
  summary?: ReactNode;
  /** Heading level. Default 'h2'. */
  component?: 'h2' | 'h3';
}

export function SectionHeader({ label, summary, component = 'h2' }: SectionHeaderProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        columnGap: 1.5,
        borderBottom: '1px solid',
        borderColor: 'primary.main',
      }}
    >
      <Typography
        variant="overline"
        component={component}
        sx={{ color: 'primary.main', letterSpacing: 1, fontSize: 12 }}
      >
        {label}
      </Typography>
      {summary && (
        <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 13 }}>
          {summary}
        </Typography>
      )}
    </Box>
  );
}
