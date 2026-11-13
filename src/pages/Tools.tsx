import type { ReactNode } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import GitHubIcon from '@mui/icons-material/GitHub';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import YouTubeIcon from '@mui/icons-material/YouTube';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import { PageHeader } from '../components/PageHeader';
import { SectionHeader } from '../components/SectionHeader';
import { ListRow, RowGroup } from '../components/ListRow';
import { layout } from '../layout';
import { toolSections, tutorials } from '../data/tools';
import type { ToolEntry, ToolLink, ToolLinkKind, Tutorial } from '../data/tools';

const linkIcon: Record<ToolLinkKind, ReactNode> = {
  github: <GitHubIcon />,
  source: <GitHubIcon />,
  app: <OpenInNewIcon />,
  'mod-portal': <OpenInNewIcon />,
};

const tutorialIcon: Record<Tutorial['kind'], ReactNode> = {
  guide: <MenuBookIcon fontSize="small" sx={{ color: 'primary.main' }} />,
  video: <YouTubeIcon fontSize="small" sx={{ color: 'primary.main' }} />,
};

function LinkButton({ link, toolName }: { link: ToolLink; toolName: string }) {
  const outlined = link.kind === 'github' || link.kind === 'source';
  return (
    <Button
      component="a"
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      variant={outlined ? 'outlined' : 'contained'}
      size="small"
      aria-label={`${link.label}: ${toolName}`}
      startIcon={linkIcon[link.kind]}
      sx={{
        minWidth: { xs: layout.touchTarget, sm: 'auto' },
        minHeight: { xs: layout.touchTarget, sm: 'auto' },
        // On phones the icon is the whole label: drop the label gap so it sits centred.
        // From sm up these are MUI's own small-button start icon margins.
        '& .MuiButton-startIcon': {
          ml: { xs: 0, sm: '-2px' },
          mr: { xs: 0, sm: '8px' },
        },
      }}
    >
      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
        {link.label}
      </Box>
    </Button>
  );
}

function ToolRow({ entry }: { entry: ToolEntry }) {
  return (
    <ListRow
      wrap
      title={
        <>
          {entry.name}
          {entry.author && (
            <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
              by {entry.author}
            </Typography>
          )}
        </>
      }
      subtitle={entry.description}
      trailing={
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {entry.links.map((link) => (
            <LinkButton key={link.url} link={link} toolName={entry.name} />
          ))}
        </Stack>
      }
    />
  );
}

export function Tools() {
  return (
    <Stack spacing={layout.sectionGap}>
      <PageHeader
        title="Tools"
        meta="The open-source toolchain used for benchmarking and publishing results."
      />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 3fr) minmax(0, 2fr)' },
          gap: 4,
          alignItems: 'start',
        }}
      >
        <Stack spacing={layout.sectionGap}>
          {toolSections.map((section) => (
            <Box key={section.title}>
              <SectionHeader label={section.title} />
              <RowGroup>
                {section.entries.map((entry) => (
                  <ToolRow key={entry.name} entry={entry} />
                ))}
              </RowGroup>
            </Box>
          ))}
        </Stack>

        <Box>
          <SectionHeader label="Learn to benchmark" />
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 1 }}>
            New to Factorio benchmarking? Start here.
          </Typography>
          <RowGroup>
            {tutorials.map((tutorial) => (
              <ListRow
                key={tutorial.url}
                href={tutorial.url}
                lead={tutorialIcon[tutorial.kind]}
                title={tutorial.label}
              />
            ))}
          </RowGroup>
        </Box>
      </Box>
    </Stack>
  );
}
