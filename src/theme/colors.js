// Design token: Premium Aesthetic color system
// Supports warm, natural cream light mode and futuristic glowing space dark mode.

export const lightColors = Object.freeze({
  // Primary brand (Warm coral/peach)
  primary: '#FC805C',
  primaryContainer: '#FFEFE8',
  primaryFixed: '#FFDAD0',
  primaryFixedDim: '#FFB49F',
  onPrimary: '#FFFFFF',
  onPrimaryContainer: '#3F0F02',

  // Secondary (Warm slate/brown)
  secondary: '#77574E',
  secondaryContainer: '#FFEFEA',
  onSecondary: '#FFFFFF',
  onSecondaryContainer: '#2C1611',

  // Tertiary (Mint green)
  tertiary: '#27C485',
  tertiaryContainer: '#E2F9F0',
  tertiaryFixedDim: '#65E3AD',
  onTertiary: '#FFFFFF',
  onTertiaryContainer: '#002113',

  // Surface stack (Warm cream/ivory layering)
  surface: '#FCFBFA',
  surfaceBright: '#FCFBFA',
  surfaceContainerLow: '#F6F3F0',
  surfaceContainer: '#F0ECE7',
  surfaceContainerHigh: '#EAE4DD',
  surfaceContainerHighest: '#E4DDD5',
  surfaceContainerLowest: '#FFFFFF', // Card background
  surfaceDim: '#DFD8D0',
  surfaceTint: '#FC805C',

  // Text colors
  onSurface: '#2A2624', // Never pure black
  onSurfaceVariant: '#6E6864',
  inverseSurface: '#36302D',
  inverseOnSurface: '#F7F0EC',
  inversePrimary: '#FFB49F',

  // Semantic
  error: '#BA1A1A',
  errorContainer: '#FFDAD6',
  onError: '#FFFFFF',
  onErrorContainer: '#410002',

  // Outline
  outline: '#85736E',
  outlineVariant: '#D8C2BC',

  // Background
  background: '#FCFBFA',
  onBackground: '#2A2624',
});

export const darkColors = Object.freeze({
  // Primary brand (Glowing electric cyan)
  primary: '#00E5FF',
  primaryContainer: '#131124',
  primaryFixed: '#00E5FF',
  primaryFixedDim: '#00B5CC',
  onPrimary: '#08070D',
  onPrimaryContainer: '#E0FDFF',

  // Secondary (Glowing neon magenta/purple)
  secondary: '#D84CFF',
  secondaryContainer: '#221230',
  onSecondary: '#FFFFFF',
  onSecondaryContainer: '#F9D8FF',

  // Tertiary (Glowing neon green)
  tertiary: '#00FF9D',
  tertiaryContainer: '#003B22',
  tertiaryFixedDim: '#00FF9D',
  onTertiary: '#002111',
  onTertiaryContainer: '#A6FFD2',

  // Surface stack (Deep space violet layering)
  surface: '#0C0B14',
  surfaceBright: '#131124',
  surfaceContainerLow: '#100E1D',
  surfaceContainer: '#18152B',
  surfaceContainerHigh: '#201D38',
  surfaceContainerHighest: '#282545',
  surfaceContainerLowest: '#131124', // Card background
  surfaceDim: '#0C0B14',
  surfaceTint: '#00E5FF',

  // Text colors
  onSurface: '#F5F3F7', // Ice-white
  onSurfaceVariant: '#A5A1B5',
  inverseSurface: '#E6E1E6',
  inverseOnSurface: '#322F37',
  inversePrimary: '#006978',

  // Semantic
  error: '#FFB4AB',
  errorContainer: '#93000A',
  onError: '#690005',
  onErrorContainer: '#FFDAD6',

  // Outline
  outline: '#8E8A9F',
  outlineVariant: '#484556',

  // Background
  background: '#0C0B14',
  onBackground: '#F5F3F7',
});

// Dynamic proxy fallback for any static references (default to light colors)
export const colors = new Proxy({}, {
  get(target, prop) {
    return lightColors[prop];
  }
});
