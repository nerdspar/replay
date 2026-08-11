import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { downscaleImage } from '../lib/downscale'
import { Icon } from './Icon'
import type { ArtworkOption, ContentType } from '../types'

interface ArtworkPickerProps {
  provider: string
  contentType: ContentType
  externalId: string
  season: number | null
  episode: number | null
  /** Currently chosen artwork URL, if any. */
  value: string | null
  onChange: (url: string | null) => void
}

const CUSTOM_OPTION_ID = 'custom'

/**
 * Choose which artwork a cartridge shows — and print. Deliberately NOT part of
 * the assignment fast path (§8.5): the first poster is picked automatically, and
 * this only appears when someone goes looking for it.
 */
export function ArtworkPicker({
  provider,
  contentType,
  externalId,
  season,
  episode,
  value,
  onChange,
}: ArtworkPickerProps) {
  const [options, setOptions] = useState<ArtworkOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [custom, setCustom] = useState<ArtworkOption | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // What the card has stored, captured once. `value` is the live highlight and
  // changes as the user browses; this must not.
  const savedRef = useRef(value)
  const saved = savedRef.current

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    api
      .artwork(provider, contentType, externalId, { season, episode })
      .then((next) => {
        if (cancelled) return
        setOptions(next)
        setError(null)
      })
      .catch((e: ApiError) => {
        if (cancelled) return
        setOptions([])
        setError(
          e.code === 'provider_unavailable'
            ? "Can't reach the artwork service right now."
            : e.message,
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [provider, contentType, externalId, season, episode])

  /**
   * Whatever the card actually has must always appear here, or picking anything else throws
   * it away with no way back.
   *
   * That is not hypothetical: a card's poster is set at assignment time from
   * the provider's *search* results, and for Cinemeta those come from IMDb,
   * while the artwork list comes from its *meta* endpoint, which returns
   * metahub's art. Same title, genuinely different images, so the one you are
   * looking at is frequently absent from the list below it.
   */
  const all = useMemo(() => {
    const list = [...options]
    const prepend = (url: string, id: string, label: string) => {
      if (list.some((o) => o.url === url)) return
      list.unshift({
        id,
        url,
        kind: url.startsWith('api/artwork/file/') ? 'custom' : 'poster',
        label,
        aspect: 'portrait',
      })
    }

    if (custom) prepend(custom.url, CUSTOM_OPTION_ID, 'Your image')

    // The SAVED artwork, not the live selection. Tracking the selection meant
    // that picking anything else dropped the original out of the list, so there
    // was no way back to it without abandoning the whole edit.
    if (saved) prepend(saved, 'current', saved.startsWith('api/artwork/file/') ? 'Your image' : 'Current')

    return list
  }, [options, custom, saved])

  const store = async (file: File) => {
    const { blob } = await downscaleImage(file)
    const uploaded = await api.uploadArtwork(blob)
    setCustom(uploaded)
    onChange(uploaded.url)
  }

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      await store(file)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /**
   * ThePosterDB has no search API and does not permit scraping, so this takes a
   * link to one poster the user already picked there and treats it exactly like
   * a file they chose — fetched once, resized, and stored locally.
   */
  const importFromLink = async () => {
    const url = window.prompt(
      'Paste the link to a poster on theposterdb.com.\n\n' +
        'Open the poster there, copy its download link, and paste it here.',
    )
    if (!url?.trim()) return

    setUploading(true)
    setError(null)
    try {
      const blob = await api.fetchArtwork(url.trim())
      await store(new File([blob], 'poster', { type: blob.type || 'image/jpeg' }))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="artwork-picker">
      {error ? <div className="banner error">{error}</div> : null}

      {loading ? (
        <div className="row">
          <div className="spinner" />
          <span className="muted">Loading artwork…</span>
        </div>
      ) : null}

      <div className="artwork-strip">
        {all.map((option) => {
          const selected = value === option.url
          return (
            <button
              key={option.id + option.url}
              type="button"
              className={`artwork-choice ${option.aspect} ${selected ? 'selected' : ''}`}
              aria-pressed={selected}
              onClick={() => onChange(option.url)}
            >
              <img src={option.url} alt={option.label} loading="lazy" decoding="async" />
              <span className="artwork-label">{option.label}</span>
            </button>
          )
        })}

      </div>

      {/*
        Outside the strip on purpose. These lived at the end of the scroller and
        were pushed off-screen behind four or five posters on a phone — present,
        but invisible. Adding your own artwork is a primary action, so it stays
        in view.
      */}
      <div className="artwork-actions">
        <button
          type="button"
          className="btn small"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? <div className="spinner" /> : <Icon name="plus" size={17} />}
          {uploading ? 'Working…' : 'Upload an image'}
        </button>

        <button
          type="button"
          className="btn small"
          disabled={uploading}
          onClick={() => void importFromLink()}
        >
          <Icon name="link" size={17} />
          ThePosterDB link
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/heic,image/*"
        hidden
        onChange={(e) => void pickFile(e.target.files?.[0])}
      />

      <p className="hint">
        Whatever you pick is used on the tile here and on printed stickers.
        ThePosterDB links look like{' '}
        <span className="mono">theposterdb.com/api/assets/123456</span>.
      </p>

      {!loading && all.length === 0 && !error ? (
        <p className="muted">No artwork available for this title.</p>
      ) : null}
    </div>
  )
}
