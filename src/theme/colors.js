// Design token: The Linear Obsidian color system
// Precision Indigo, Achromatic Slate, and Vibrant Emerald.
// Inspired by high-contrast, data-dense engineering design systems (Linear & Raycast).

export const lightColors = Object.freeze({
  // Primary brand (Precision Indigo)
  primary: '#4F46E5',
  primaryContainer: '#EEF2FF',
  primaryFixed: '#E0E7FF',
  primaryFixedDim: '#C7D2FE',
  onPrimary: '#FFFFFF',
  onPrimaryContainer: '#1E1B4B',

  // Secondary (Technical Slate)
  secondary: '#0F172A',
  secondaryContainer: '#F1F5F9',
  onSecondary: '#FFFFFF',
  onSecondaryContainer: '#050505',

  // Tertiary (Crisp Emerald — financial growth & positive signals only)
  tertiary: '#059669',
  tertiaryContainer: '#ECFDF5',
  tertiaryFixedDim: '#10B981',
  onTertiary: '#FFFFFF',
  onTertiaryContainer: '#064E3B',

  // Surface stack (Achromatic Slate layering)
  surface: '#FBFBFC',
  surfaceBright: '#FFFFFF',
  surfaceContainerLow: '#F8F9FA',
  surfaceContainer: '#F1F3F5',
  surfaceContainerHigh: '#E9ECEF',
  surfaceContainerHighest: '#DEE2E6',
  surfaceContainerLowest: '#FFFFFF', // Card background
  surfaceDim: '#E9ECEF',
  surfaceTint: '#4F46E5',

  // Text colors (Authoritative Black & Deep Charcoal)
  onSurface: '#050505', // True Deep Black (21:1 contrast)
  onSurfaceVariant: '#1F2937', // Deep Charcoal Black (11.5:1 contrast)
  inverseSurface: '#1E293B',
  inverseOnSurface: '#F8FAFC',
  inversePrimary: '#818CF8',

  // Semantic
  error: '#DC2626',
  errorContainer: '#FEE2E2',
  onError: '#FFFFFF',
  onErrorContainer: '#7F1D1D',

  // Outline
  outline: '#64748B',
  outlineVariant: '#CBD5E1',

  // Background
  background: '#FBFBFC',
  onBackground: '#050505',
});

export const darkColors = Object.freeze({
  // Primary brand (Luminous Indigo)
  primary: '#818CF8',
  primaryContainer: '#1E1B4B',
  primaryFixed: '#6366F1',
  primaryFixedDim: '#4F46E5',
  onPrimary: '#0A0B0E',
  onPrimaryContainer: '#E0E7FF',

  // Secondary (Muted Technical Slate)
  secondary: '#94A3B8',
  secondaryContainer: '#1E293B',
  onSecondary: '#0A0B0E',
  onSecondaryContainer: '#F1F5F9',

  // Tertiary (Vibrant Mint / Emerald — financial growth & positive signals only)
  tertiary: '#10B981',
  tertiaryContainer: '#064E3B',
  tertiaryFixedDim: '#34D399',
  onTertiary: '#022C22',
  onTertiaryContainer: '#A7F3D0',

  // Surface stack (Deep Matte Obsidian layering)
  surface: '#0A0B0E',
  surfaceBright: '#181922',
  surfaceContainerLow: '#0E0F14',
  surfaceContainer: '#12131A',
  surfaceContainerHigh: '#1B1C24',
  surfaceContainerHighest: '#252732',
  surfaceContainerLowest: '#12131A', // Card background
  surfaceDim: '#0A0B0E',
  surfaceTint: '#818CF8',

  // Text colors (Pure White & Crisp Slate 200)
  onSurface: '#FFFFFF', // Pure White
  onSurfaceVariant: '#E2E8F0', // Slate 200 (ultra legible high contrast)
  inverseSurface: '#F1F5F9',
  inverseOnSurface: '#050505',
  inversePrimary: '#4F46E5',

  // Semantic
  error: '#FB7185',
  errorContainer: '#4C0519',
  onError: '#4C0519',
  onErrorContainer: '#FECDD3',

  // Outline
  outline: '#64748B',
  outlineVariant: '#1E202B',

  // Background
  background: '#0A0B0E',
  onBackground: '#FFFFFF',
});

// Dynamic proxy fallback for any static references (default to light colors)
export const colors = new Proxy({}, {
  get(target, prop) {
    return lightColors[prop];
  }
});
