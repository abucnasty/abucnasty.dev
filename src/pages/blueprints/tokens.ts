// Colours and type for the Blueprints page, taken from the approved screens.
export const colors = {
  void: '#000000',
  panel: '#121212',
  /** Selected row, and a row under the pointer. */
  panelRaised: '#1e1e1e',
  rowHover: '#1a1a1a',
  rule: 'rgba(255,255,255,0.12)',
  fieldBorder: 'rgba(255,255,255,0.24)',
  amber: '#fca300',
  amberLight: '#ffba37',
  /** Versions; the theme's secondary.light, for contrast on black. */
  green: '#81d99a',
  text: '#ffffff',
  /** Row text, notes, the link address. */
  soft: '#d6d6d6',
  secondary: '#b3b3b3',
  /** Only for a plate with no render yet. */
  ghost: '#4a9eea',
  ghostText: '#6fb4f2',
} as const;

export const titleFont = "'Titillium Web', 'Roboto', 'Helvetica', 'Arial', sans-serif";
export const monoFont = "'Roboto Mono', 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace";

/** The amber focus ring used on every control of the page. */
export const focusRing = {
  outline: 'none',
  '&:focus-visible': { outline: `2px solid ${colors.amber}`, outlineOffset: '2px' },
} as const;

/** Space taken above the stage's content: the top bar plus the stage's top and bottom padding. */
export const PLATE_CHROME = 48 + 64;
