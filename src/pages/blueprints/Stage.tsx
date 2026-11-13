import type { ReactNode } from 'react';
import { Box, ButtonBase } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { blueprintRoute, imageUrl, stringUrl, type CatalogEntry } from '../../catalog';
import { layout } from '../../layout';
import { ActionRow } from './ActionRow';
import { Contents, Facts, Notes, NotesBody, SectionTitle, Versions, textLink } from './Details';
import { findNode, isBook, nodeLabel, shownImage } from './model';
import { useNotes } from './notes';
import { GhostPlate, Plate } from './Plate';
import { PLATE_CHROME, colors, focusRing, titleFont } from './tokens';

export type Measured = Record<string, { width: number; height: number }>;

/** How the stage is arranged; decided by the shape of the image being shown. */
type Arrangement = 'stacked' | 'side' | 'book' | 'phone';

/** Below this aspect (width / height) the plate stands beside the details. */
const SIDE_BELOW = 1.15;
/** A book whose image is at most this wide for its height keeps its contents beside the picture. */
const BOOK_SIDE_UP_TO = 2.5;

const column = (gap: number) => ({ display: 'flex', flexDirection: 'column', gap: `${gap}px`, minWidth: 0 }) as const;

/** The stage's frame: padding on wide screens, the phone's own spacing below md. */
export function StageFrame({ phone, children, label }: { phone: boolean; children: ReactNode; label?: string }) {
  return (
    <Box
      component="section"
      aria-label={label}
      data-stage
      sx={{
        flex: '1 1 0',
        p: phone ? '4px 16px 32px' : '32px 32px 48px',
        ...column(phone ? 16 : 24),
      }}
    >
      {children}
    </Box>
  );
}

function BackLink() {
  return (
    <Box
      component={RouterLink}
      to="/blueprints"
      sx={{
        alignSelf: 'flex-start',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height: layout.touchTarget,
        fontSize: 14,
        color: colors.secondary,
        textDecoration: 'none',
        '&:hover': { color: colors.amberLight },
        ...focusRing,
      }}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      All blueprints
    </Box>
  );
}

function Header({ entry, crumbs, title, phone }: { entry: CatalogEntry; crumbs: string[] | null; title: string; phone: boolean }) {
  const by = entry.authors.length ? `by ${entry.authors.join(', ')}` : '';
  return (
    <Box sx={column(6)}>
      {crumbs && (
        <Box component="p" data-crumbs sx={{ m: 0, fontSize: 14, color: colors.secondary }}>
          <Box component={RouterLink} to={blueprintRoute(entry.path)} replace sx={{ ...textLink, color: colors.secondary }}>
            {entry.title}
          </Box>
          {crumbs.map((c, i) => (
            <span key={i}> / {c}</span>
          ))}
        </Box>
      )}
      <Box
        component="h2"
        sx={{ m: 0, fontFamily: titleFont, fontSize: phone ? 28 : 34, fontWeight: 600, lineHeight: 1.15, overflowWrap: 'anywhere' }}
      >
        {title}
      </Box>
      {(entry.version || by || entry.deprecated) && (
        <Box
          component="p"
          data-meta
          sx={{ m: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 16px', fontSize: 14, color: colors.secondary }}
        >
          {entry.version && (
            <Box component="span" sx={{ fontFamily: titleFont, fontSize: 16, fontWeight: 600, color: colors.green }}>
              {entry.version}
            </Box>
          )}
          {by && <span>{by}</span>}
          {entry.deprecated && <span>Deprecated</span>}
        </Box>
      )}
    </Box>
  );
}

interface StageProps {
  entry: CatalogEntry;
  /** Slot path from `?entry=`, if any. */
  nodePath: string | null;
  phone: boolean;
  measured: Measured;
  onMeasured: (src: string, width: number, height: number) => void;
}

export function Stage({ entry, nodePath, phone, measured, onMeasured }: StageProps) {
  const found = nodePath ? findNode(entry.nodes, nodePath) : null;
  const node = found?.node ?? null;
  const book = isBook(entry);
  const image = shownImage(entry, node);
  const src = image ? imageUrl(entry.path, image.file) : null;
  const size = image?.width && image?.height ? { width: image.width, height: image.height } : src ? measured[src] : undefined;
  const aspect = size ? size.width / size.height : null;

  let arrangement: Arrangement = 'stacked';
  if (phone) arrangement = 'phone';
  else if (src && aspect !== null) {
    if (book && aspect <= BOOK_SIDE_UP_TO) arrangement = 'book';
    else if (aspect < SIDE_BELOW) arrangement = 'side';
  }

  const entryNotes = useNotes(entry.path, entry.blueprint.description);
  const nodeNotes = useNotes(node?.folder, undefined);
  const notes = node?.folder ? nodeNotes : entryNotes;

  const title = node ? nodeLabel(node) : entry.title;
  const crumbs = found ? found.ancestors.map(nodeLabel) : null;
  const url = stringUrl(entry.path, node?.path);
  const header = <Header entry={entry} crumbs={crumbs} title={title} phone={phone} />;
  const fit = arrangement === 'phone' ? 'phone' : arrangement === 'stacked' ? 'stacked' : 'side';
  const plate =
    src && image ? (
      <Plate src={src} alt={`Render of ${title}`} width={size?.width} height={size?.height} fit={fit} onMeasured={onMeasured} />
    ) : (
      <GhostPlate />
    );
  const contents = book ? (
    <Contents entry={entry} selected={node ? node.path : null} fit={arrangement === 'book' ? 'side' : arrangement === 'phone' ? 'phone' : 'stacked'} />
  ) : null;
  const label = `${title}${node ? `, in ${entry.title}` : ''}`;

  if (arrangement === 'phone') {
    return (
      <StageFrame phone label={label}>
        <BackLink />
        {header}
        <ActionRow url={url} layout="column" phone />
        {plate}
        {contents}
        <Facts entry={entry} />
        <Notes text={notes} />
        <Versions entry={entry} />
      </StageFrame>
    );
  }

  if (arrangement === 'stacked') {
    return (
      <StageFrame phone={false} label={label}>
        {header}
        <ActionRow url={url} layout="row" phone={false} />
        {plate}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '32px 64px' }}>
          <Box sx={{ flex: '1 1 280px', maxWidth: 400, ...column(24) }}>
            {contents}
            <Facts entry={entry} />
          </Box>
          <Box sx={{ flex: '2 1 320px', maxWidth: 560, ...column(24) }}>
            <Notes text={notes} />
            <Versions entry={entry} />
          </Box>
        </Box>
      </StageFrame>
    );
  }

  const frame = (children: ReactNode) => (
    <Box
      component="section"
      aria-label={label}
      data-stage
      data-arrangement={arrangement}
      sx={{ flex: '1 1 0', minWidth: 0, p: '32px', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '32px 48px' }}
    >
      {children}
    </Box>
  );

  if (arrangement === 'book') {
    return frame(
      <>
        <Box sx={{ flex: '1 1 480px', ...column(28) }}>
          {plate}
          <Box sx={column(12)}>
            <SectionTitle>About the book</SectionTitle>
            {entryNotes && <NotesBody text={entryNotes} />}
            <Facts entry={entry} />
          </Box>
          <Versions entry={entry} />
        </Box>
        <Box sx={{ flex: '1 1 320px', maxWidth: 360, ...column(24) }}>
          {header}
          <ActionRow url={url} layout="column" phone={false} />
          {contents}
          {node?.folder && <Notes text={nodeNotes} />}
        </Box>
      </>,
    );
  }

  // Side by side: the plate stands on the left as tall as the window allows and stays put.
  const a = aspect ?? 1;
  return frame(
    <>
      <Box
        data-plate-column
        sx={{
          flex: `0 1 max(240px, min(${size?.width ?? 0}px, calc((100vh - ${PLATE_CHROME}px) * ${a}), calc(100% - 388px)))`,
          minWidth: 0,
          position: 'sticky',
          top: layout.topBarHeight + 32,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {plate}
      </Box>
      <Box sx={{ flex: '1 1 340px', maxWidth: 560, ...column(24) }}>
        {header}
        <ActionRow url={url} layout="column" phone={false} />
        <Facts entry={entry} />
        <Notes text={notes} />
        <Versions entry={entry} />
      </Box>
    </>,
  );
}

/** Loading, failure and an unknown address, in place of a build. */
export function StageMessage({
  kind,
  phone,
  onRetry,
  back = phone,
}: {
  kind: 'loading' | 'failed' | 'unknown';
  phone: boolean;
  onRetry?: () => void;
  /** Show "All blueprints" above the message (a phone's build page). */
  back?: boolean;
}) {
  if (kind === 'loading') {
    return (
      <StageFrame phone={phone} label="Loading the catalog">
        <GhostPlate text="Loading the catalog" />
      </StageFrame>
    );
  }
  return (
    <StageFrame phone={phone}>
      {back && <BackLink />}
      <Box sx={column(8)} role={kind === 'failed' ? 'alert' : undefined} data-stage-message={kind}>
        <Box component="h2" sx={{ m: 0, fontFamily: titleFont, fontSize: phone ? 24 : 28, fontWeight: 600, lineHeight: 1.2 }}>
          {kind === 'failed' ? "The blueprint catalog didn't load." : 'No blueprint at this address.'}
        </Box>
        {kind === 'failed' ? (
          <>
            <Box component="p" sx={{ m: 0, color: colors.soft }}>
              Check your connection, then try again.
            </Box>
            <ButtonBase
              onClick={onRetry}
              sx={{
                alignSelf: 'flex-start',
                mt: 1,
                height: 44,
                px: '28px',
                backgroundColor: colors.amber,
                color: '#000',
                fontFamily: titleFont,
                fontSize: 16,
                fontWeight: 700,
                '&:hover': { backgroundColor: colors.amberLight },
                ...focusRing,
              }}
            >
              Try again
            </ButtonBase>
          </>
        ) : (
          <Box component={RouterLink} to="/blueprints" sx={{ ...textLink, alignSelf: 'flex-start' }}>
            See all blueprints
          </Box>
        )}
      </Box>
    </StageFrame>
  );
}
