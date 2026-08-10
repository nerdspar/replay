import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { episodeBadge } from '../components/Poster'
import {
  PAGE_SIZES,
  STICKER_PRESETS,
  paginate,
  planGrid,
  withCopies,
  type PageSize,
  type StickerPreset,
} from '../lib/sheet'
import type { Card } from '../types'

type Fit = 'cover' | 'contain'

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

  const plan = useMemo(
    () => planGrid({ page, margin, gap, sticker: { width, height } }),
    [page, margin, gap, width, height],
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
                : 'Rounds the cut guide as well as the artwork, so the guide matches the shape you cut to.'}
            </p>
          </label>

          <p className="hint" style={{ marginTop: 10 }}>
            The cartridge label is measured from the shell. Change these only if
            your print came out a different size.
          </p>
        </div>

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

        <div className="card">
          <h2>Look</h2>
          <div className="switch">
            <span>Cut guides</span>
            <input
              type="checkbox"
              checked={guides}
              onChange={(e) => setGuides(e.target.checked)}
            />
          </div>
          <p className="hint">
            Guides are drawn in the gap between stickers, never on the artwork.
          </p>

          <div className="row" style={{ gap: 8, marginTop: 12 }}>
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

        {plan.impossible ? (
          <div className="banner error">
            A {width} × {height} mm sticker does not fit on {page.label} with a{' '}
            {margin} mm margin. Reduce the size or the margin.
          </div>
        ) : (
          <div className="banner alert">
            {plan.columns} across × {plan.rows} down — {plan.perPage} per page,{' '}
            {pages.length} page{pages.length === 1 ? '' : 's'} for{' '}
            {chosen.length * copies} sticker{chosen.length * copies === 1 ? '' : 's'}.
          </div>
        )}

        <button
          className="btn primary block"
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
          Shown at real proportions. In the print dialog, set scale to 100% and
          turn off "fit to page", or the sizes above will not come out right.
        </p>
      </div>

      <div
        className="sheets"
        ref={sheetsRef}
        style={
          {
            '--page-w': `${page.width}mm`,
            '--page-h': `${page.height}mm`,
            '--sticker-w': `${width}mm`,
            '--sticker-h': `${height}mm`,
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
                <div
                  className={`sticker ${guides ? 'guides' : ''}`}
                  key={`${card.id}-${index}`}
                >
                  {/*
                    No crossOrigin on the image: poster hosts do not all send
                    CORS headers, and setting it would fail the load outright.
                    Nothing here reads pixels, so it is not needed.
                  */}
                  <div className="sticker-art">
                    {card.poster_url ? (
                      <img src={card.poster_url} alt="" style={{ objectFit: fit }} />
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
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
