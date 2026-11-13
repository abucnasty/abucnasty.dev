import { createTheme } from '@mui/material/styles';

// Ported verbatim from factorio-scripts/clock-generator-ui/src/App.tsx
export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#fca300',
      light: '#ffba37',
    },
    secondary: {
      main: '#5eb664',
      light: '#81d99a',
    },
    background: {
      default: '#000000',
      paper: '#121212',
    },
    common: {
      black: '#121212',
    },
    error: {
      main: '#ff5958',
    },
  },
  shape: {
    borderRadius: 0,
  },
  spacing: (factor: number) => factor * 7,
});
