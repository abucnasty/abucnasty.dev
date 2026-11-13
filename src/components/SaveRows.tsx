import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Box, Chip, IconButton, Link, Tooltip } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import LinkIcon from '@mui/icons-material/Link';
import { Link as RouterLink } from 'react-router-dom';
import { formatBytes, formatSaveCount } from '../format';
import { layout } from '../layout';
import { saveFolderRoute, type SaveFile } from '../saves';

export const monoFont = '"Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const rowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1.5,
  borderBottom: 1,
  borderColor: 'divider',
  fontSize: 14,
  transition: 'background-color 120ms',
  '&:hover': { backgroundColor: 'action.hover' },
} as const;

/**
 * File names and paths are long unspaced strings. Offer the browser a break
 * after each separator so narrow screens wrap them there, not mid-word.
 */
function breakable(text: string): ReactNode {
  // Runs of name followed by their separators: "bm_", "9_", "tiles.", "zip".
  // (No lookbehind: Safari only supports it from 16.4.)
  const parts = text.match(/[^/_.-]+[/_.-]*|[/_.-]+/g) ?? [text];
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <wbr />}
      {part}
    </Fragment>
  ));
}

type Breakpoint = 'sm' | 'md';

/** Right-aligned numeric column that only exists from `from` up. */
const wideColumn = (from: Breakpoint) =>
  ({
    display: { xs: 'none', [from]: 'block' },
    textAlign: 'right',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    color: 'text.secondary',
  }) as const;

/** Small second line that stands in for the columns below `from`. */
const foldedMeta = (from: Breakpoint) =>
  ({
    display: { xs: 'block', [from]: 'none' },
    fontSize: 12.5,
    color: 'text.secondary',
  }) as const;

interface SaveFolderRowProps {
  /** Folder path to open (the end of a collapsed chain, when there is one). */
  path: string;
  label: string;
  /** Label is a benchmark title rather than a folder name. */
  titled?: boolean;
  count: number;
  bytes: number;
  /** Landing-page rows also get date + Factorio version columns. */
  details?: { date?: string; version?: string };
}

export function SaveFolderRow({ path, label, titled, count, bytes, details }: SaveFolderRowProps) {
  // Five columns need more room than three before they stop squeezing the title.
  const wideFrom: Breakpoint = details ? 'md' : 'sm';
  const folded = [details?.date, details?.version && `Factorio ${details.version}`].filter(Boolean);

  return (
    <Box
      component={RouterLink}
      to={saveFolderRoute(path)}
      sx={{
        ...rowSx,
        minHeight: { xs: 48, md: layout.rowHeight },
        py: { xs: 0.75, md: 0.25 },
        pl: 1.5,
        pr: 1,
        color: 'text.primary',
        textDecoration: 'none',
      }}
    >
      <FolderOutlinedIcon sx={{ color: 'primary.main', fontSize: 20, flexShrink: 0 }} />
      {details && (
        <Box sx={{ ...wideColumn(wideFrom), flex: '0 0 88px', textAlign: 'left' }}>{details.date ?? '—'}</Box>
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box
          sx={
            titled
              ? { fontSize: 14, fontWeight: 700, overflowWrap: 'anywhere' }
              : { fontFamily: monoFont, fontSize: 13.5, overflowWrap: 'anywhere' }
          }
        >
          {label}
        </Box>
        {folded.length > 0 && <Box sx={foldedMeta(wideFrom)}>{folded.join(' · ')}</Box>}
      </Box>
      {details && (
        <Box sx={{ display: { xs: 'none', [wideFrom]: 'flex' }, flex: '0 0 76px' }}>
          {details.version && <Chip label={details.version} size="small" variant="outlined" />}
        </Box>
      )}
      <Box sx={{ ...wideColumn(wideFrom), flex: '0 0 80px' }}>{formatSaveCount(count)}</Box>
      <Box
        sx={{
          flex: { xs: '0 0 auto', [wideFrom]: '0 0 68px' },
          textAlign: 'right',
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatBytes(bytes)}
        <Box sx={foldedMeta(wideFrom)}>{formatSaveCount(count)}</Box>
      </Box>
      <ChevronRightIcon sx={{ color: 'text.secondary', fontSize: 18, flexShrink: 0 }} />
    </Box>
  );
}

interface SaveFileRowProps {
  file: SaveFile;
  /** Show the containing folder as a link under the name (search results). */
  showFolder?: boolean;
}

export function SaveFileRow({ file, showFolder }: SaveFileRowProps) {
  return (
    <Box sx={{ ...rowSx, minHeight: { xs: 52, md: 36 }, py: { xs: 0.5, md: 0 }, pl: 1.5, pr: 0.5 }}>
      <InsertDriveFileOutlinedIcon sx={{ color: 'text.secondary', fontSize: 20, flexShrink: 0 }} />
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          py: 0.5,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 0.25,
          overflowWrap: 'anywhere',
        }}
      >
        <Link
          href={file.url}
          underline="hover"
          sx={{ color: 'text.primary', fontFamily: monoFont, fontSize: { xs: 12.5, sm: 13.5 } }}
        >
          {breakable(file.name)}
        </Link>
        {showFolder && (
          <Link
            component={RouterLink}
            to={saveFolderRoute(file.dir)}
            underline="hover"
            sx={{ color: 'primary.light', fontFamily: monoFont, fontSize: 12 }}
          >
            {breakable(file.dir)}
          </Link>
        )}
        <Box sx={foldedMeta('sm')}>{formatBytes(file.bytes)}</Box>
      </Box>
      <Box sx={{ ...wideColumn('sm'), flex: '0 0 76px' }}>{formatBytes(file.bytes)}</Box>
      <CopyButton
        text={file.url}
        label={`Copy download link for ${file.name}`}
        tooltip="Copy download link"
        icon={<LinkIcon fontSize="small" />}
        hideOnPhone
      />
      <Tooltip title="Download">
        <IconButton
          component="a"
          href={file.url}
          color="primary"
          aria-label={`Download ${file.name}`}
          sx={{ width: { xs: 44, md: 32 }, height: { xs: 44, md: 32 }, flexShrink: 0 }}
        >
          <DownloadIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

interface CopyButtonProps {
  text: string;
  /** Accessible name. */
  label: string;
  tooltip: string;
  icon?: ReactNode;
  /** Phones long-press the download link instead; the row has no room for both. */
  hideOnPhone?: boolean;
}

/** Icon button that copies `text` and shows a tick for a moment afterwards. */
export function CopyButton({ text, label, tooltip, icon, hideOnPhone }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = () => {
    // Clipboard access can be refused (permissions, insecure context), so
    // only show the tick once the write has really happened.
    const write = navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'));
    write.then(
      () => setState('copied'),
      () => setState('failed'),
    );
  };

  return (
    <Tooltip title={state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy' : tooltip}>
      <IconButton
        onClick={copy}
        aria-label={label}
        sx={{
          display: hideOnPhone ? { xs: 'none', sm: 'inline-flex' } : 'inline-flex',
          width: { xs: 44, md: 32 },
          height: { xs: 44, md: 32 },
          flexShrink: 0,
          color: state === 'copied' ? 'secondary.light' : 'text.secondary',
        }}
      >
        {state === 'copied' ? <CheckIcon fontSize="small" /> : (icon ?? <ContentCopyIcon fontSize="small" />)}
      </IconButton>
    </Tooltip>
  );
}
