/**
 * Typefaces a spine label can be set in.
 *
 * Every one is a stack of faces already on the machine — nothing is fetched.
 * A web font would have to be downloaded before the sheet could be measured,
 * and a print that went to paper mid-download would come out in the fallback at
 * a different width from the preview. These are also the faces the canvas
 * export can use, so the printed sheet and the PNG agree.
 *
 * No stack is available everywhere, which is why each ends in a generic family:
 * a Windows machine has no Avenir and a Linux one may have none of them. The
 * preview shows what THIS machine will actually print, which is the only
 * question that matters at the moment of printing.
 */
export interface SpineFont {
  id: string
  /** Shown to the user, set in the face itself. */
  label: string
  stack: string
}

export const SPINE_FONTS: SpineFont[] = [
  {
    id: 'system',
    label: 'System',
    stack:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  { id: 'helvetica', label: 'Helvetica', stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: 'avenir', label: 'Avenir', stack: 'Avenir, "Avenir Next", "Segoe UI", sans-serif' },
  { id: 'futura', label: 'Futura', stack: 'Futura, "Century Gothic", "URW Gothic", sans-serif' },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, "DejaVu Sans", sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet MS', stack: '"Trebuchet MS", Tahoma, sans-serif' },
  { id: 'georgia', label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'palatino', label: 'Palatino', stack: 'Palatino, "Palatino Linotype", "Book Antiqua", serif' },
  { id: 'baskerville', label: 'Baskerville', stack: 'Baskerville, "Libre Baskerville", Georgia, serif' },
  { id: 'times', label: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
  { id: 'courier', label: 'Courier New', stack: '"Courier New", Courier, monospace' },
  { id: 'impact', label: 'Impact', stack: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif' },
]

/** Falls back to the system stack, so an unknown id never leaves text unset. */
export function fontStack(id: string | null | undefined): string {
  return (SPINE_FONTS.find((font) => font.id === id) ?? SPINE_FONTS[0]!).stack
}

export function fontLabel(id: string | null | undefined): string {
  return (SPINE_FONTS.find((font) => font.id === id) ?? SPINE_FONTS[0]!).label
}
