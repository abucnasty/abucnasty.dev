import type { ReactNode } from 'react';
import { Table, TableContainer } from '@mui/material';
import { layout } from '../layout';

interface DenseTableProps {
  children: ReactNode;
  'aria-label'?: string;
}

export function DenseTable({ children, 'aria-label': ariaLabel }: DenseTableProps) {
  return (
    <TableContainer sx={{ border: 1, borderColor: 'divider' }}>
      <Table
        size="small"
        aria-label={ariaLabel}
        sx={{
          '& th': { fontWeight: 700 },
          '& th, & td': {
            px: { xs: 1, sm: 1.25 },
            py: { xs: 0.75, md: 0.25 },
            verticalAlign: 'middle',
          },
          '& tbody tr': { height: { md: layout.rowHeight } },
        }}
      >
        {children}
      </Table>
    </TableContainer>
  );
}
