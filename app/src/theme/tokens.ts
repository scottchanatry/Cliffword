/**
 * Design tokens, taken from docs/BRIEF.md ("Look") and the 390x844 design previews.
 *
 * v1 ships a light theme only (app.json userInterfaceStyle "light"): every color below is
 * a light-ground value. A dark theme would add a second palette with the same keys and
 * pick one in a ThemeProvider; nothing outside src/theme reads raw hex values.
 */

export const colors = {
  /** App background ("ground"). */
  ground: '#F3F4F1',
  /** Primary text, primary buttons, selected pills. */
  ink: '#16181D',
  /** Secondary text. */
  muted: '#5B616B',
  /** Darker secondary text for labels on grey panels. */
  mutedStrong: '#454A54',
  /** Text on the light grey status chip. */
  chipText: '#2C3038',
  /** Cards and sheets. */
  card: '#FFFFFF',
  /** Text and icons on ink. */
  onInk: '#FFFFFF',
  /** Dots inside an ink cliff gap. */
  onInkDot: '#F3F4F1',

  /** Emphasis text (timers, current round, accent words). */
  accentText: '#B4530A',
  accentTextPressed: '#8A3F07',
  /** Live voice / cliff gap orange from the Voice previews. */
  live: '#FF8A3D',

  /** Surprise heat ramp: expected -> surprising (word shading, gloss chips). */
  heat1: '#FFE9C7',
  heat2: '#FFC46B',
  heat3: '#F08A1D',

  /** Word tiles by age: newest line lightest, oldest darkest. */
  tileNew: '#DDE0D8',
  tileMid: '#C6CAC1',
  tileOld: '#A6AB9F',
  /** Neutral dot on charts (landing line, retell lanes). */
  dot: '#8A8F86',

  /** Outline buttons and pills. */
  border: '#C9CCC4',
  /** Dividers inside cards, grey panels, status chip background. */
  borderSoft: '#E4E6E0',
  /** Dashed outlines (hold area, empty lane). */
  borderDashed: '#B5B9AF',
  /** Progress track. */
  track: '#D5D8D0',
  /** Dims the screen behind a coach mark (ink at 35%). */
  scrim: 'rgba(22, 24, 29, 0.35)',
} as const;

export type ColorName = keyof typeof colors;

/**
 * Experience card motifs (no flags, no photos): a ground color and two shape colors per regional
 * variety of a series (LibraryTrack.dialect). Decorative only; text never sits on them.
 */
export const motifColors = {
  /** Caribbean sea, sun, coral. */
  pr: { ground: '#0E7C86', a: '#FFC145', b: '#FF7A6B' },
  /** Walled-town orange, palm green, sand. */
  co: { ground: '#E8833A', a: '#2D9C5B', b: '#FFE08A' },
  /** Evening blue, café cream, tango violet. */
  ar: { ground: '#4F7FDB', a: '#F7F3E8', b: '#9B6BDB' },
  /** Market pink, cactus green, marigold. */
  mx: { ground: '#D9467F', a: '#2BB673', b: '#FFD166' },
  /** Clay red, grey-sky white, slate. */
  pe: { ground: '#C0533B', a: '#F4E3C1', b: '#5D6D7E' },
  /** Rainforest green, mint, banana yellow. */
  cr: { ground: '#2E8B57', a: '#A8E6CF', b: '#F9C74F' },
} as const;

export type MotifName = keyof typeof motifColors;

/** Heat level 0 (expected) to 3 (most surprising), as the engine's WordScore.heat. */
export const heatColors: readonly [string | null, string, string, string] = [
  null,
  colors.heat1,
  colors.heat2,
  colors.heat3,
];

/** Spacing scale in dp. Screen edges are 24 at the sides, 28 at the top. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 28,
} as const;

export const layout = {
  screenPaddingX: 24,
  screenPaddingTop: 28,
  screenPaddingBottom: 24,
  /** Vertical gap between blocks on a screen. */
  screenGap: 16,
  /** Width the previews are drawn at. */
  designWidth: 390,
  designHeight: 844,
  /** Minimum touch target (Apple HIG 44 pt; Material asks 48 dp, so key controls use 56). */
  minTouch: 44,
  /** Height of primary actions (Hold to speak). */
  primaryHeight: 56,
} as const;

export const radii = {
  /** Word tiles. */
  tile: 7,
  /** Gloss chips, lane bars. */
  chip: 10,
  /** Outline buttons inside cards. */
  control: 12,
  /** Command buttons (Otra vez), small stat cards, grey panels. */
  panel: 14,
  /** Primary buttons. */
  button: 16,
  /** List cards on Music. */
  list: 18,
  /** Cards. */
  card: 20,
  /** The big hold-to-speak area. */
  holdArea: 28,
  /** Pills and round buttons. */
  pill: 999,
} as const;

export const borders = {
  hairline: 1,
  strong: 2,
} as const;

/** Letter spacing for 12 px uppercase eyebrows: 0.08em. */
export const eyebrowTracking = 0.96;
