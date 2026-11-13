import { useEffect, useState, type ReactNode } from 'react';
import { AppBar, Box, ButtonBase, Container, Drawer, IconButton, List, ListItem, ListItemButton, ListItemText, Toolbar, Typography } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import SearchIcon from '@mui/icons-material/Search';
import { NavLink as RouterNavLink, Link as RouterLink, useLocation } from 'react-router-dom';
import { SocialLinks } from './SocialLinks';
import { BrandAvatar } from './BrandAvatar';
import { layout } from '../layout';
import { SearchProvider, useSearch } from './SearchDialog';

const navItems = [
  { to: '/benchmarks', label: 'Benchmarks' },
  { to: '/blueprints', label: 'Blueprints' },
  { to: '/saves', label: 'Saves' },
  { to: '/tools', label: 'Tools' },
  { to: '/blog', label: 'Blog' },
];

interface AppShellProps {
  children: ReactNode;
}

/** True when typing here should type, not trigger a shortcut. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function AppShell({ children }: AppShellProps) {
  return (
    <SearchProvider>
      <Shell>{children}</Shell>
    </SearchProvider>
  );
}

function Shell({ children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { isOpen: searchOpen, open: openSearch } = useSearch();
  // The Blueprints page lays out its own full-width columns under the top bar.
  const { pathname } = useLocation();
  const fullBleed = pathname === '/blueprints' || pathname.startsWith('/blueprints/');

  // "/" opens search unless the visitor is typing somewhere; Ctrl+K and Cmd+K work everywhere.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const ctrlK = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k';
      const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextEntry(e.target);
      if (!ctrlK && !slash) return;
      e.preventDefault();
      openSearch();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openSearch]);

  // Search opens over the menu drawer, not under it.
  useEffect(() => {
    if (searchOpen) setDrawerOpen(false);
  }, [searchOpen]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="sticky" color="default" elevation={0} sx={{ backgroundColor: 'background.paper' }}>
        <Toolbar variant="dense" sx={{ gap: 2, minHeight: layout.topBarHeight }}>
          <Box
            component={RouterLink}
            to="/"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <BrandAvatar sx={{ width: 28, height: 28, borderWidth: '2px' }} />
            <Typography
              variant="h6"
              sx={{
                color: 'primary.main',
                fontWeight: 700,
                letterSpacing: 1,
                // With five nav items the wordmark only fits beside them from `md`.
                display: { xs: 'none', md: 'block' },
              }}
            >
              abucnasty
            </Typography>
          </Box>
          <Box sx={{ flexGrow: 1 }} />

          {/* Desktop nav */}
          <Box component="nav" sx={{ display: { xs: 'none', sm: 'flex' }, gap: 3 }}>
            {navItems.map((item) => (
              <Typography
                key={item.to}
                component={RouterNavLink}
                to={item.to}
                sx={{
                  color: 'text.primary',
                  textDecoration: 'none',
                  textTransform: 'uppercase',
                  fontSize: 14,
                  letterSpacing: 1,
                  '&.active': { color: 'primary.main' },
                  '&:hover': { color: 'primary.light' },
                }}
              >
                {item.label}
              </Typography>
            ))}
          </Box>

          {/* Search: a small field from md, an icon button below it. */}
          <ButtonBase
            onClick={openSearch}
            aria-label="Search the site"
            sx={{
              display: { xs: 'none', md: 'flex' },
              alignItems: 'center',
              gap: 1,
              height: 32,
              px: 1.25,
              border: 1,
              borderColor: 'divider',
              color: 'text.secondary',
              fontSize: 14,
              '&:hover': { color: 'text.primary', backgroundColor: 'action.hover' },
            }}
          >
            <SearchIcon sx={{ fontSize: 18 }} />
            <span>Search</span>
            <Box
              component="kbd"
              aria-hidden
              sx={{ fontFamily: 'inherit', fontSize: 12, px: 0.75, border: 1, borderColor: 'divider', lineHeight: 1.4 }}
            >
              /
            </Box>
          </ButtonBase>
          <IconButton
            sx={{ display: { xs: 'flex', md: 'none' }, width: layout.touchTarget, height: layout.touchTarget }}
            onClick={openSearch}
            aria-label="Search the site"
          >
            <SearchIcon />
          </IconButton>

          {/* Mobile hamburger */}
          <IconButton
            sx={{ display: { xs: 'flex', sm: 'none' }, width: layout.touchTarget, height: layout.touchTarget }}
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            edge="end"
          >
            <MenuIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Mobile drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        disableScrollLock
        PaperProps={{ sx: { width: 220, backgroundColor: 'background.paper' } }}
      >
        <List sx={{ pt: 2 }}>
          {navItems.map((item) => (
            <ListItem key={item.to} disablePadding>
              <ListItemButton
                component={RouterNavLink}
                to={item.to}
                onClick={() => setDrawerOpen(false)}
                sx={{
                  '&.active .MuiListItemText-primary': { color: 'primary.main' },
                }}
              >
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{ textTransform: 'uppercase', fontSize: 14, letterSpacing: 1 }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Drawer>

      {fullBleed ? (
        <Box component="main" sx={{ flexGrow: 1, display: 'flex', minWidth: 0 }}>
          {children}
        </Box>
      ) : (
        <Container component="main" maxWidth="lg" sx={{ flexGrow: 1, py: 3 }}>
          {children}
        </Container>
      )}

      <Box
        component="footer"
        sx={{
          backgroundColor: 'common.black',
          py: 3,
          mt: 'auto',
        }}
      >
        <Container maxWidth="lg" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 2 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              © {new Date().getFullYear()} abucnasty
            </Typography>
            <Typography
              variant="body2"
              component={RouterLink}
              to="/about"
              sx={{ color: 'text.secondary', textDecoration: 'none', '&:hover': { color: 'primary.main' } }}
            >
              About
            </Typography>
          </Box>
          <SocialLinks />
        </Container>
      </Box>
    </Box>
  );
}
