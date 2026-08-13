import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { episodeBadge } from '../components/Poster'
import {
  PAGE_SIZES,
  STICKER_PRESETS,
  fitsCricutDesignArea,
  paginate,
  planGrid,
  withCopies,
  type PageSize,
  type StickerPreset,
} from '../lib/sheet'
import {
  EXPORT_DPI,
  downloadBlob,
  renderSpinePng,
  renderStickerPng,
  spineFileName,
  stickerFileName,
} from '../lib/exportSticker'
import { fitBackdrop, objectFitFor, type FitBackdrop } from '../lib/artFit'
import {
  SPINE_HEIGHT_MM,
  SPINE_PAD_RATIO,
  fitSpineText,
  spineColors,
  spineMeasurer,
  spineText,
} from '../lib/spine'
import { SPINE_FONTS, fontStack } from '../lib/spineFonts'
import type { Card, SpineAlign, Settings } from '../types'

/** What one cartridge's spine looks like once its artwork has been read. */
interface SpineRender {
  background: string
  text: string
  label: string
  sizeMm: number
}

type Fit = 'cover' | 'contain'

/**
 * The two ways a sticker gets made, and they share almost nothing.
 *
 * Cutting by hand means printing a laid-out sheet from the browser, so page
 * size, margins, gutter and cut guides all matter. A Cricut is handed one image
 * per sticker and does its own layout in Design Space, so none of them do —
 * including the registration margins this page used to set, because Print Then
 * Cut prints from Design Space and can only register a sheet it printed itself.
 *
 * They were previously one screen with a checkbox, which left every reader
 * working out for themselves which of the controls their method ignored.
 */
type PrintMethod = 'hand' | 'cricut'

export function PrintSheet() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const [preset, setPreset] = useState<StickerPreset>(STICKER_PRESETS[0]!)
  const [page, setPage] = useState<PageSize>(PAGE_SIZES[0]!)
  const [width, setWidth] = useState(STICKER_PRESETS[0]!.width)
  const [height, setHeight] = useState(STICKER_PRESETS[0]!.height)
  const [radius, setRadius] = useState(STICKER_PRESETS[0]!.radius)
  const [margin, setMargin] = useState(10)
  const [gap, setGap] = useState(3)
  const [copies, setCopies] = useState(1)
  const [fit, setFit] = useState<Fit>('cover')
  const [guides, setGuides] = useState(true)
  const [method, setMethod] = useState<PrintMethod>('hand')
  const [spineLabels, setSpineLabels] = useState(false)
  const [spineHeight, setSpineHeight] = useState(SPINE_HEIGHT_MM)
  /*
    Font and alignment are saved, unlike everything else on this screen.

    They are not really print settings — they are how a shelf of cartridges
    looks, so they should hold from one print to the next, and the edit sheet's
    preview cannot be honest about where a title truncates without knowing the
    face it will be set in.
  */
  const [spineFont, setSpineFont] = useState('system')
  const [spineAlign, setSpineAlign] = useState<SpineAlign>('left')

  useEffect(() => {
    void api
      .getSettings()
      .then((s: Settings) => {
        setSpineFont(s.spine_font ?? 'system')
        setSpineAlign(s.spine_align ?? 'left')
      })
      .catch(() => undefined)
  }, [])

  /** Saved as chosen: this screen has no Save button, and never has had one. */
  const rememberSpineStyle = (patch: { spine_font?: string; spine_align?: SpineAlign }) => {
    void api.saveSettings(patch).catch(() => undefined)
  }
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportError, setExportError] = useState<string | null>(null)

  const [artworkReady, setArtworkReady] = useState(false)
  const sheetsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api
      .listCards()
      .then((next) => {
        setCards(next)
        const ids = params.get('ids')
        const requested = ids
          ? new Set(
              ids
                .split(',')
                .map(Number)
                .filter((n) => Number.isFinite(n)),
            )
          : null
        setSelected(
          requested && requested.size > 0
            ? new Set(next.filter((c) => requested.has(c.id)).map((c) => c.id))
            : new Set(next.map((c) => c.id)),
        )
      })
      .catch(() => setCards([]))
      .finally(() => setLoading(false))
    // Selection is seeded once, from the link that opened this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyPreset = (next: StickerPreset) => {
    setPreset(next)
    setWidth(next.width)
    setHeight(next.height)
    setRadius(next.radius)
  }

  const chosen = useMemo(
    () => cards.filter((card) => selected.has(card.id)),
    [cards, selected],
  )

  /*
    Backdrops for covers that do not fill the sticker.

    Computed here rather than inside each sticker because a card can appear on
    the sheet several times when copies are set, and reading pixels back off a
    canvas once per copy would be wasted work. Keyed by card id, so a sticker
    renders on a white background for one frame and then settles.
  */
  const [backdrops, setBackdrops] = useState<Record<number, FitBackdrop>>({})

  useEffect(() => {
    const needed = chosen.filter((card) => card.art_fit && card.art_fit !== 'crop')
    if (needed.length === 0) return

    let cancelled = false
    void Promise.all(
      needed.map(async (card) => [card.id, await fitBackdrop(card, card.art_fit!)] as const),
    ).then((entries) => {
      if (!cancelled) setBackdrops(Object.fromEntries(entries))
    })

    return () => {
      cancelled = true
    }
  }, [chosen])

  const cricut = method === 'cricut'

  /**
   * A spine is the same cartridge's other edge, so it is exactly as wide as the
   * face and sits directly beneath it — one grid cell holds both. That keeps
   * the two halves of a cartridge adjacent on the paper instead of on separate
   * sheets, and pagination needs no notion of spines at all.
   */
  const cellHeight = spineLabels ? height + gap + spineHeight : height

  // A 4 mm radius on a 7 mm strip is very nearly a pill. Kept proportional so
  // the spine reads as the same family as the label without becoming a lozenge.
  const spineRadius = Math.min(radius, spineHeight / 4)

  /**
   * Print Then Cut has a maximum design area, and each sticker is imported as
   * its own image — so the limit applies to the sticker, not to any page. Only
   * a hand-typed size can breach it, and the failure otherwise arrives in
   * Design Space long after the images were made.
   */
  /*
    Spine colours and text, worked out once per cartridge.

    Same shape as the backdrops above and for the same reason: a card can appear
    several times when copies are set, and decoding its cover once per copy
    would be wasted work. The text is fitted here too, so the printed strip and
    the exported PNG are laid out by one function rather than by two that agree
    until someone edits one of them.
  */
  const [spineData, setSpineData] = useState<Record<number, SpineRender>>({})

  useEffect(() => {
    if (!spineLabels || chosen.length === 0) return

    let cancelled = false
    const measure = spineMeasurer(fontStack(spineFont))

    void Promise.all(
      chosen.map(async (card) => {
        const colors = await spineColors(card)
        const fitted = fitSpineText(spineText(card), width, spineHeight, measure)
        return [
          card.id,
          {
            background: colors.background,
            text: colors.text,
            label: fitted.text,
            sizeMm: fitted.size,
          },
        ] as const
      }),
    ).then((entries) => {
      if (!cancelled) setSpineData(Object.fromEntries(entries))
    })

    return () => {
      cancelled = true
    }
  }, [chosen, spineLabels, width, spineHeight, spineFont])

  const cricutSizeOk = useMemo(
    () => fitsCricutDesignArea({ width, height }),
    [width, height],
  )

  const plan = useMemo(
    () => planGrid({ page, margin, gap, sticker: { width, height: cellHeight } }),
    [page, margin, gap, width, cellHeight],
  )

  const pages = useMemo(
    () => (plan.impossible ? [] : paginate(withCopies(chosen, copies), plan.perPage)),
    [chosen, copies, plan],
  )

  /**
   * Printing before the artwork has decoded produces blank stickers, and the
   * user only finds out on paper. So the button waits.
   */
  useEffect(() => {
    let cancelled = false
    setArtworkReady(false)

    const images = Array.from(sheetsRef.current?.querySelectorAll('img') ?? [])
    if (images.length === 0) {
      setArtworkReady(true)
      return
    }

    Promise.allSettled(images.map((image) => image.decode())).then(() => {
      if (!cancelled) setArtworkReady(true)
    })

    return () => {
      cancelled = true
    }
  }, [pages])

  /**
   * `@page { size }` cannot read a CSS variable, and it is what stops the
   * browser from re-scaling the sheet to its own default paper. So it is
   * written out as real declarations whenever the chosen page changes.
   */
  useEffect(() => {
    const id = 'cartridge-page-size'
    const style =
      document.getElementById(id) ??
      Object.assign(document.createElement('style'), { id })
    style.textContent = `@page { size: ${page.width}mm ${page.height}mm; margin: 0; }`
    if (!style.isConnected) document.head.appendChild(style)
    return () => style.remove()
  }, [page])

  const print = useCallback(() => window.print(), [])

  /**
   * Design Space imports images, not printed pages, so each sticker is rendered
   * to its own PNG at true size. Sequential rather than parallel: browsers
   * throttle bursts of downloads, and a slow one would be dropped silently.
   */
  /**
   * Every file this export will produce, in the order they download.
   *
   * A card's spine follows its face rather than all spines coming last, so a
   * failure part-way through leaves whole cartridges done instead of a pile of
   * labels with no spines.
   */
  const exportJobs = useMemo(() => {
    const jobs: { card: Card; kind: 'face' | 'spine' }[] = []
    for (const card of chosen) {
      jobs.push({ card, kind: 'face' })
      if (spineLabels) jobs.push({ card, kind: 'spine' })
    }
    return jobs
  }, [chosen, spineLabels])

  const exportForCricut = async () => {
    setExporting(true)
    setExportError(null)
    const failed: string[] = []

    for (const [index, job] of exportJobs.entries()) {
      setExportProgress(index + 1)
      try {
        const blob =
          job.kind === 'face'
            ? await renderStickerPng(job.card, {
                widthMm: width,
                heightMm: height,
                radiusMm: radius,
                round: preset.shape === 'round',
                fit,
              })
            : await renderSpinePng(job.card, {
                widthMm: width,
                heightMm: spineHeight,
                radiusMm: spineRadius,
                font: spineFont,
                align: spineAlign,
              })
        downloadBlob(
          blob,
          job.kind === 'face'
            ? stickerFileName(job.card, width, height)
            : spineFileName(job.card, width, spineHeight),
        )
        await new Promise((resolve) => setTimeout(resolve, 350))
      } catch (e) {
        failed.push(
          job.kind === 'spine' ? `${job.card.title} (spine)` : job.card.title,
        )
      }
    }

    setExporting(false)
    setExportProgress(0)
    if (failed.length > 0) {
      setExportError(`Could not make an image for: ${failed.join(', ')}`)
    }
  }

  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (loading) {
    return (
      <div className="center-empty">
        <div className="spinner" style={{ margin: '0 auto 10px' }} />
        Loading your library…
      </div>
    )
  }

  return (
    <>
      <div className="no-print">
        <div className="row between" style={{ marginBottom: 14 }}>
          <button className="btn small" onClick={() => navigate('/')}>
            ← Library
          </button>
          <span className="muted">
            {chosen.length} of {cards.length} selected
          </span>
        </div>

        <div className="tabs" role="tablist" aria-label="How you are cutting">
          <button
            role="tab"
            aria-selected={!cricut}
            className={!cricut ? 'active' : ''}
            onClick={() => setMethod('hand')}
          >
            Print &amp; cut by hand
          </button>
          <button
            role="tab"
            aria-selected={cricut}
            className={cricut ? 'active' : ''}
            onClick={() => setMethod('cricut')}
          >
            Cricut
          </button>
        </div>

        <div className="card">
          <h2>Sticker size</h2>
          <div className="preset-list" style={{ marginTop: 10 }}>
            {STICKER_PRESETS.map((option) => (
              <button
                key={option.id}
                className={`preset ${preset.id === option.id ? 'selected' : ''}`}
                onClick={() => applyPreset(option)}
              >
                <strong>{option.label}</strong>
                <span className="hint">
                  {option.width} × {option.height} mm
                  {option.shape === 'round'
                    ? ' · round'
                    : option.radius > 0
                      ? ` · ${option.radius} mm corners`
                      : ''}
                </span>
                <span className="hint">{option.hint}</span>
              </button>
            ))}
          </div>

          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <label className="field" style={{ flex: 1, marginBottom: 0 }}>
              <span>Width (mm)</span>
              <input
                type="number"
                min={5}
                max={200}
                step={0.5}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
              />
            </label>
            <label className="field" style={{ flex: 1, marginBottom: 0 }}>
              <span>Height (mm)</span>
              <input
                type="number"
                min={5}
                max={280}
                step={0.5}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="field" style={{ marginTop: 12, marginBottom: 0 }}>
            <span>Corner radius (mm)</span>
            <input
              type="number"
              min={0}
              max={Math.min(width, height) / 2}
              step={0.5}
              value={preset.shape === 'round' ? Math.min(width, height) / 2 : radius}
              disabled={preset.shape === 'round'}
              onChange={(e) => setRadius(Number(e.target.value))}
            />
            <p className="hint">
              {preset.shape === 'round'
                ? 'Round stickers are always fully rounded.'
                : cricut
                  ? 'Rounds the exported image, leaving its corners transparent — Print Then Cut traces the opaque shape, so this is the line the machine cuts.'
                  : 'Rounds the cut guide as well as the artwork, so the guide matches the shape you cut to.'}
            </p>
          </label>

          <p className="hint" style={{ marginTop: 10 }}>
            The cartridge label is measured from the shell. Change these only if
            your print came out a different size.
          </p>
        </div>

        {/*
          Page, margins, gutter and copies describe a sheet this app lays out
          and prints. Design Space lays out its own, so none of it reaches a
          Cricut and it is hidden rather than merely ignored.
        */}
        {cricut ? null : (
        <div className="card">
          <h2>Page</h2>
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {PAGE_SIZES.map((size) => (
              <button
                key={size.id}
                className={`btn small ${page.id === size.id ? 'primary' : ''}`}
                onClick={() => setPage(size)}
              >
                {size.label}
              </button>
            ))}
          </div>

          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <label className="field" style={{ flex: 1, marginBottom: 0 }}>
              <span>Page margin (mm)</span>
              <input
                type="number"
                min={0}
                max={30}
                step={0.5}
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value))}
              />
            </label>
            <label className="field" style={{ flex: 1, marginBottom: 0 }}>
              <span>Gap (mm)</span>
              <input
                type="number"
                min={0}
                max={20}
                step={0.5}
                value={gap}
                onChange={(e) => setGap(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="hint">
            Most printers cannot print to the very edge. Keep a margin of about
            10 mm unless you know yours goes closer.
          </p>

          <label className="field" style={{ marginTop: 14, marginBottom: 0 }}>
            <span>Copies of each</span>
            <input
              type="number"
              min={1}
              max={50}
              value={copies}
              onChange={(e) => setCopies(Number(e.target.value))}
            />
          </label>
        </div>
        )}

        <div className="card">
          <h2>Spine labels</h2>
          <div className="switch">
            <span>Include spine labels</span>
            <input
              type="checkbox"
              checked={spineLabels}
              onChange={(e) => setSpineLabels(e.target.checked)}
            />
          </div>
          <p className="hint">
            The strip along the edge of the cartridge, in the colour of its
            artwork. Each one sits directly under its own label
            {cricut ? ' and downloads with it' : ' on the sheet'}, so a cartridge
            comes out in one piece.
          </p>

          {spineLabels ? (
            <>
              <label className="field" style={{ marginTop: 14, marginBottom: 0 }}>
                <span>Spine height (mm)</span>
                <input
                  type="number"
                  min={4}
                  max={30}
                  step={0.5}
                  value={spineHeight}
                  onChange={(e) => setSpineHeight(Number(e.target.value))}
                />
              </label>
              <p className="hint">
                The width matches the label above — it is the same cartridge.
                Text shrinks to fit and is shortened if it still will not,
                so set a shorter name under <strong>Edit → On the spine</strong>{' '}
                for anything long.
              </p>
              <div className="row" style={{ gap: 8, marginTop: 14 }}>
                {(['left', 'center', 'right'] as SpineAlign[]).map((option) => (
                  <button
                    key={option}
                    className={`btn small grow ${spineAlign === option ? 'primary' : ''}`}
                    onClick={() => {
                      setSpineAlign(option)
                      rememberSpineStyle({ spine_align: option })
                    }}
                  >
                    {option === 'left' ? 'Left' : option === 'center' ? 'Centre' : 'Right'}
                  </button>
                ))}
              </div>
              <p className="hint">
                Where the words sit. Left lines a shelf up down its edge; centred
                reads better when the titles are short and about the same length.
              </p>

              <label className="field" style={{ marginTop: 14, marginBottom: 6 }}>
                <span>Typeface</span>
              </label>
              {/*
                A list rather than a select. Each name is set in its own face,
                and iOS Safari ignores font-family on an <option> — so a native
                dropdown would show twelve identical lines.
              */}
              <div className="font-list">
                {SPINE_FONTS.map((option) => (
                  <button
                    key={option.id}
                    className={`font-option ${spineFont === option.id ? 'selected' : ''}`}
                    style={{ fontFamily: option.stack }}
                    onClick={() => {
                      setSpineFont(option.id)
                      rememberSpineStyle({ spine_font: option.id })
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="hint">
                Faces already on this device, so nothing is downloaded and the
                print matches the preview. One that your machine does not have
                falls back to the nearest it does — which is what you see above.
                Typeface and alignment are remembered; the rest of this screen is
                not.
              </p>

            </>
          ) : null}
        </div>

        <div className="card">
          <h2>Look</h2>
          {cricut ? null : (
            <>
              <div className="switch">
                <span>Cut guides</span>
                <input
                  type="checkbox"
                  checked={guides}
                  onChange={(e) => setGuides(e.target.checked)}
                />
              </div>
              <p className="hint">
                Dashed lines showing where to cut. They sit exactly on the edge
                of each sticker and follow its corner radius, so cutting along
                the line gives you the size above. Turn them off for a clean
                sheet.
              </p>
            </>
          )}

          <div className="row" style={{ gap: 8, marginTop: cricut ? 0 : 12 }}>
            <button
              className={`btn small ${fit === 'cover' ? 'primary' : ''}`}
              onClick={() => setFit('cover')}
            >
              Fill (crop)
            </button>
            <button
              className={`btn small ${fit === 'contain' ? 'primary' : ''}`}
              onClick={() => setFit('contain')}
            >
              Fit (whole image)
            </button>
          </div>
          <p className="hint">
            {Math.abs(height / width - 1.5) < 0.02
              ? 'This sticker is 2:3, the same shape as a poster, so both options look identical for poster artwork. They differ for a background or a logo.'
              : 'Fill crops the edges to fill the sticker; Fit shows the whole image and leaves white bars.'}
          </p>
        </div>

        <div className="card">
          <h2>Which cartridges</h2>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button
              className="btn small"
              onClick={() => setSelected(new Set(cards.map((c) => c.id)))}
            >
              All
            </button>
            <button className="btn small" onClick={() => setSelected(new Set())}>
              None
            </button>
          </div>
          <div className="list" style={{ marginTop: 12 }}>
            {cards.map((card) => (
              <button key={card.id} className="list-row" onClick={() => toggle(card.id)}>
                <span className={`dot ${selected.has(card.id) ? 'ok' : ''}`} />
                <span className="grow">
                  {card.title}
                  <span className="hint" style={{ display: 'block' }}>
                    {[card.year, episodeBadge(card.season, card.episode)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {card.poster_url ? null : <span className="pill">no artwork</span>}
              </button>
            ))}
          </div>
        </div>

        {cricut ? (
          <>
            {cricutSizeOk ? null : (
              <div className="banner error">
                A {width} × {height} mm sticker is larger than the biggest design
                Print Then Cut can handle. Reduce the size above.
              </div>
            )}
            <button
              className="btn primary block"
              disabled={exportJobs.length === 0 || exporting || !cricutSizeOk}
              onClick={() => void exportForCricut()}
            >
              {exporting
                ? `Making image ${exportProgress} of ${exportJobs.length}…`
                : `Download ${exportJobs.length} image${exportJobs.length === 1 ? '' : 's'} for Design Space`}
            </button>
            <p className="hint">
              One PNG per cartridge at {width} × {height} mm
              {spineLabels ? `, plus a ${width} × ${spineHeight} mm spine each` : ''}
              , {EXPORT_DPI} dpi, with the corners cut out so Print Then Cut
              follows the rounded shape. Upload them in Design Space, arrange
              them on a sheet there, and use Print Then Cut. Your browser may ask
              permission to download several files.
            </p>
            {exportError ? <p className="hint warn">{exportError}</p> : null}
          </>
        ) : (
          <>
            {plan.impossible ? (
              <div className="banner error">
                A {width} × {height} mm sticker
                {spineLabels
                  ? ` and its ${spineHeight} mm spine need ${cellHeight} mm, which does not fit`
                  : ' does not fit'}{' '}
                on {page.label} with a {margin} mm margin. Reduce the size or the
                margin{spineLabels ? ', or turn off spine labels' : ''}.
              </div>
            ) : (
              <div className="banner alert">
                {plan.columns} across × {plan.rows} down — {plan.perPage} per page,{' '}
                {pages.length} page{pages.length === 1 ? '' : 's'} for{' '}
                {chosen.length * copies} sticker
                {chosen.length * copies === 1 ? '' : 's'}.
              </div>
            )}

            <button
              className="btn block primary"
              disabled={pages.length === 0 || !artworkReady}
              onClick={print}
            >
              {pages.length === 0
                ? 'Nothing to print'
                : artworkReady
                  ? `Print ${pages.length} page${pages.length === 1 ? '' : 's'}`
                  : 'Preparing artwork…'}
            </button>

            <h2 style={{ fontSize: 16, margin: '22px 0 8px' }}>Preview</h2>
            <p className="hint" style={{ marginBottom: 12 }}>
              Shown at real proportions. In the print dialog, set scale to 100%
              and turn off "fit to page", or the sizes above will not come out
              right.
            </p>
          </>
        )}
      </div>

      {/*
        Only built for the hand-cut path. It is the thing `window.print()`
        prints, and a Cricut never sees it.
      */}
      {cricut ? null : (
      <div
        className="sheets"
        ref={sheetsRef}
        style={
          {
            '--page-w': `${page.width}mm`,
            '--page-h': `${page.height}mm`,
            '--sticker-w': `${width}mm`,
            '--sticker-h': `${height}mm`,
            '--cell-h': `${cellHeight}mm`,
            '--spine-h': `${spineHeight}mm`,
            '--spine-radius': `${spineRadius}mm`,
            '--spine-pad': `${spineHeight * SPINE_PAD_RATIO}mm`,
            '--sheet-margin': `${margin}mm`,
            '--sheet-gap': `${gap}mm`,
            '--sticker-radius': preset.shape === 'round' ? '50%' : `${radius}mm`,
          } as React.CSSProperties
        }
      >
        {pages.map((items, pageIndex) => (
          <div className="sheet-page" key={pageIndex}>
            <div className="sheet-grid" style={{ gridTemplateColumns: `repeat(${plan.columns}, var(--sticker-w))` }}>
              {items.map((card, index) => (
                <div className="sheet-cell" key={`${card.id}-${index}`}>
                <div className={`sticker ${guides ? 'guides' : ''}`}>
                  {/*
                    No crossOrigin on the image: poster hosts do not all send
                    CORS headers, and setting it would fail the load outright.
                    Nothing here reads pixels, so it is not needed.
                  */}
                  <div
                    className="sticker-art"
                    style={{ background: backdrops[card.id]?.color ?? '#ffffff' }}
                  >
                    {/*
                      Behind a cover that does not fill the sticker. A 24px
                      image stretched to fill: the browser's own smoothing is
                      the blur, because CSS filters are unreliable in print.
                    */}
                    {backdrops[card.id]?.blurUrl ? (
                      <img className="sticker-backdrop" src={backdrops[card.id]!.blurUrl!} alt="" />
                    ) : null}
                    {card.poster_url ? (
                      <img
                        src={card.poster_url}
                        alt=""
                        style={{ objectFit: card.art_fit ? objectFitFor(card.art_fit) : fit }}
                      />
                    ) : (
                      <span className="sticker-fallback">{card.title}</span>
                    )}
                  </div>
                  {/*
                    The only thing a poster cannot tell you. Overlaid rather
                    than given its own bar, so the artwork keeps the full label
                    and a 2:3 poster is never cropped to make room for text.
                  */}
                  {episodeBadge(card.season, card.episode) ? (
                    <span className="sticker-badge">
                      {episodeBadge(card.season, card.episode)}
                    </span>
                  ) : null}
                </div>
                {/*
                  Rendered only once its colour is known. A spine drawn before
                  the artwork has been read would print white, and on paper
                  there is no second frame to settle into.
                */}
                {spineLabels && spineData[card.id] ? (
                  <div
                    className={`spine ${guides ? 'guides' : ''}`}
                    style={{
                      background: spineData[card.id]!.background,
                      justifyContent:
                        spineAlign === 'center'
                          ? 'center'
                          : spineAlign === 'right'
                            ? 'flex-end'
                            : 'flex-start',
                    }}
                  >
                    <span
                      style={{
                        color: spineData[card.id]!.text,
                        fontSize: `${spineData[card.id]!.sizeMm}mm`,
                        fontFamily: fontStack(spineFont),
                      }}
                    >
                      {spineData[card.id]!.label}
                    </span>
                  </div>
                ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      )}
    </>
  )
}
