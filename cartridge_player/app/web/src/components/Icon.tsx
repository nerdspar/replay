/**
 * A small monochrome icon set.
 *
 * Inline SVG rather than an icon font or emoji: emoji render as full-colour
 * pictures that differ on every platform and cannot inherit the text colour, so
 * they never look like part of the interface. These take `currentColor`, so a
 * selected tab, a muted hint, and a destructive button all get the right icon
 * for free.
 *
 * One consistent drawing style: 24x24 box, 1.75 stroke, round caps and joins,
 * no fills.
 */

export type IconName =
  | 'library'
  | 'settings'
  | 'help'
  | 'plus'
  | 'link'
  | 'film'
  | 'check'
  | 'trash'
  | 'eject'
  | 'search'
  | 'play'
  | 'close'
  | 'music'

interface IconProps {
  name: IconName
  /** Pixel size; the icon is square. */
  size?: number
  className?: string
}

const PATHS: Record<IconName, JSX.Element> = {
  // A cartridge: shell, label, and the contact slot along the bottom.
  library: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <rect x="7.5" y="6.5" width="9" height="7" rx="1.25" />
      <path d="M8.5 17.5h7" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.94a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  // Diagnostics: a pulse trace. Reads as "is this alive", which is the page.
  help: (
    <>
      <path d="M3 12h4l2.5-6 4 12L16 12h5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  link: (
    <>
      <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1.5 1.5" />
      <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1.5-1.5" />
    </>
  ),
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 4v16M16 4v16M3 12h18M3 8h5M3 16h5M16 8h5M16 16h5" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M10 4h4M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" />
      <path d="M10.5 11v6M13.5 11v6" />
    </>
  ),
  // Unassign: lift the contents out, keep the cartridge.
  eject: (
    <>
      <path d="M12 4.5 5.5 12h13L12 4.5Z" />
      <path d="M5.5 16.5h13" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  play: <path d="M7.5 5.5v13l11-6.5-11-6.5Z" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  // A quaver: the one shape that reads as "music" at 17px.
  music: (
    <>
      <path d="M9 18V5l10-2v13" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </>
  ),
}

export function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative throughout; every icon sits beside a text label.
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
