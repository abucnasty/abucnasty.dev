import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import YouTubeIcon from '@mui/icons-material/YouTube';

interface LatestVideo {
  id: string;
  title: string;
  published?: string;
  url: string;
}

/**
 * The channel's newest upload, from the Worker (worker/latestVideo.ts), which holds the YouTube API
 * key. Under `vite dev` or `vite preview` there is no Worker, so the path answers 404 or index.html
 * and the card shows its "couldn't load" message; `wrangler dev` serves the real thing (see README).
 */
async function fetchLatestVideo(): Promise<LatestVideo | null> {
  const res = await fetch('/api/latest-video', { headers: { Accept: 'application/json' } });
  if (!res.headers.get('Content-Type')?.includes('application/json')) {
    console.warn('/api/latest-video is served by the Worker; run `wrangler dev` to load the latest video locally.');
    return null;
  }
  const data = (await res.json()) as Partial<LatestVideo> & { message?: string };
  if (!res.ok || typeof data.id !== 'string' || typeof data.url !== 'string') {
    if (data.message) console.warn(`Latest video: ${data.message}`);
    return null;
  }
  return { id: data.id, title: data.title ?? '', published: data.published, url: data.url };
}

export function LatestVideo({ compact = false }: { compact?: boolean }) {
  const [video, setVideo] = useState<LatestVideo | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLatestVideo()
      .then((v) => {
        if (!cancelled) setVideo(v);
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, ...(compact && { pt: 1.25 }) }}>
        <CircularProgress size={18} />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Loading latest video…
        </Typography>
      </Box>
    );
  }

  if (!video) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary', ...(compact && { pt: 1.25 }) }}>
        Couldn't load the latest video.{' '}
        <Link
          href="https://www.youtube.com/@abucnasty"
          target="_blank"
          rel="noopener noreferrer"
        >
          Visit the channel
        </Link>
        .
      </Typography>
    );
  }

  const thumbUrl = `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;

  if (compact) {
    // The thumbnail and the title are one link to the video; no inline player.
    return (
      <Link
        href={video.url}
        target="_blank"
        rel="noopener noreferrer"
        underline="none"
        color="text.primary"
        sx={{
          pt: 1.25,
          display: 'flex',
          gap: 1.5,
          alignItems: 'flex-start',
          '&:hover .video-title': { textDecoration: 'underline' },
        }}
      >
        <Box
          sx={{
            position: 'relative',
            width: { xs: 140, sm: 160 },
            flexShrink: 0,
            aspectRatio: '16 / 9',
            backgroundColor: 'common.black',
            overflow: 'hidden',
          }}
        >
          <Box
            component="img"
            src={thumbUrl}
            alt=""
            loading="lazy"
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              m: 'auto',
              width: 32,
              height: 32,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'primary.main',
              color: 'common.black',
            }}
          >
            <PlayArrowIcon sx={{ fontSize: 22 }} />
          </Box>
        </Box>
        <Typography
          className="video-title"
          variant="body2"
          sx={{
            fontWeight: 600,
            minWidth: 0,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {video.title}
        </Typography>
      </Link>
    );
  }

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={{ xs: 2, sm: 3 }}
      sx={{
        backgroundColor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        p: { xs: 2, sm: 2.5 },
        alignItems: { xs: 'stretch', sm: 'center' },
      }}
    >
      <Box
        onClick={() => !playing && setPlaying(true)}
        sx={{
          position: 'relative',
          width: { xs: '100%', sm: 320 },
          flexShrink: 0,
          aspectRatio: '16 / 9',
          backgroundColor: 'common.black',
          cursor: playing ? 'default' : 'pointer',
          overflow: 'hidden',
          '&:hover .play-overlay': {
            backgroundColor: 'rgba(0,0,0,0.35)',
          },
          '&:hover .play-icon': {
            transform: 'translate(-50%, -50%) scale(1.1)',
          },
        }}
      >
        {playing ? (
          <Box
            component="iframe"
            src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1`}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              border: 0,
            }}
          />
        ) : (
          <>
            <Box
              component="img"
              src={thumbUrl}
              alt=""
              loading="lazy"
              sx={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
            <Box
              className="play-overlay"
              sx={{
                position: 'absolute',
                inset: 0,
                backgroundColor: 'rgba(0,0,0,0.15)',
                transition: 'background-color 150ms',
              }}
            />
            <IconButton
              className="play-icon"
              aria-label={`Play ${video.title}`}
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                backgroundColor: 'primary.main',
                color: 'common.black',
                width: 56,
                height: 56,
                transition: 'transform 150ms',
                '&:hover': { backgroundColor: 'primary.main' },
              }}
            >
              <PlayArrowIcon sx={{ fontSize: 36 }} />
            </IconButton>
          </>
        )}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="overline"
          sx={{ color: 'primary.main', letterSpacing: 2, display: 'block' }}
        >
          Latest video
        </Typography>
        <Typography variant="h6" sx={{ mt: 0.5, lineHeight: 1.25 }}>
          {video.title}
        </Typography>
        {video.published && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            Published {new Date(video.published).toLocaleDateString()}
          </Typography>
        )}
        <Button
          component={Link}
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          variant="outlined"
          size="small"
          startIcon={<YouTubeIcon />}
          sx={{ mt: 2 }}
        >
          Watch on YouTube
        </Button>
      </Box>
    </Stack>
  );
}
