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

const YT_CHANNEL_ID = 'UCSdiZ-R-EnnHqKvCrZdQMBQ';
// The uploads playlist ID for any channel is the channel ID with the `UC`
// prefix replaced by `UU`. Fetching this playlist's first item costs 1 quota
// unit, vs. 100 for the search endpoint.
const YT_UPLOADS_PLAYLIST_ID = `UU${YT_CHANNEL_ID.slice(2)}`;
const YT_API_KEY = import.meta.env.VITE_YT_API_KEY as string | undefined;

interface LatestVideo {
  id: string;
  title: string;
  published?: string;
  url: string;
}

interface PlaylistItemsResponse {
  items?: Array<{
    snippet?: {
      title?: string;
      publishedAt?: string;
      resourceId?: { videoId?: string };
    };
  }>;
}

async function fetchLatestVideo(): Promise<LatestVideo | null> {
  if (!YT_API_KEY) {
    console.warn('VITE_YT_API_KEY is not set; latest video cannot be loaded.');
    return null;
  }
  const url =
    `https://www.googleapis.com/youtube/v3/playlistItems` +
    `?part=snippet&maxResults=1&playlistId=${YT_UPLOADS_PLAYLIST_ID}` +
    `&key=${YT_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as PlaylistItemsResponse;
  const snippet = data.items?.[0]?.snippet;
  const id = snippet?.resourceId?.videoId;
  if (!snippet || !id) return null;
  return {
    id,
    title: snippet.title ?? '',
    published: snippet.publishedAt,
    url: `https://www.youtube.com/watch?v=${id}`,
  };
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
