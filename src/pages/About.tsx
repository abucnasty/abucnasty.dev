import { Box, Stack, Typography } from '@mui/material';
import { SocialLinks } from '../components/SocialLinks';
import { BrandAvatar } from '../components/BrandAvatar';

export function About() {
  return (
    <Stack spacing={6}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={4} alignItems="flex-start">
        <BrandAvatar
          sx={{
            width: { xs: 96, md: 140 },
            height: { xs: 96, md: 140 },
          }}
        />
        <Box>
          <Typography variant="h3">About</Typography>
          <Typography
            variant="body1"
            sx={{ color: 'text.secondary', mt: 2, maxWidth: 720, fontSize: 17 }}
          >
            Hi, I'm <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>abucnasty</Box>{' '}
            — an experienced software developer who creates Factorio content and
            research as a hobby. This site is where I publish my UPS benchmarks,
            blueprint registry, and the small tools I build along the way.
          </Typography>
          <Typography
            variant="body1"
            sx={{ color: 'text.secondary', mt: 2, maxWidth: 720, fontSize: 17 }}
          >
            Everything here is open source. If you find something useful, want to
            collaborate, or just want to nerd out about update cycles, the links
            below are the best ways to reach me.
          </Typography>
          <Box sx={{ mt: 3 }}>
            <SocialLinks />
          </Box>
        </Box>
      </Stack>
    </Stack>
  );
}
