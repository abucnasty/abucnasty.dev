import { Button, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export function NotFound() {
  return (
    <Stack spacing={3} sx={{ alignItems: 'flex-start', py: 6 }}>
      <Typography variant="overline" sx={{ color: 'primary.main' }}>
        404
      </Typography>
      <Typography variant="h3">Page not found</Typography>
      <Button component={RouterLink} to="/" variant="contained">
        Back to home
      </Button>
    </Stack>
  );
}
