import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { Poster } from './Poster'
import { Sheet } from './Sheet'
import type { Card, ContentType, Meta, MetaPreview } from '../types'

const SEARCH_DEBOUNCE_MS = 300

interface AssignSheetProps {
  tagUid: string
  /** Set when re-pointing an existing cartridge rather than assigning a new one. */
  existing?: Card | null
  onClose: () => void
  onSaved: (card: Card) => void
}

type Stage = 'search' | 'choose-scope' | 'pick-episode'

/**
 * §8.5 — the primary interaction, and the one that has to be fast on a phone:
 * type a title, tap a poster, (for series) accept "Whole show", save.
 */
export function AssignSheet({ tagUid, existing, onClose, onSaved }: AssignSheetProps) {
  const [type, setType] = useState<ContentType>(existing?.content_type ?? 'movie')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MetaPreview[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [selected, setSelected] = useState<MetaPreview | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('search')

  const [label, setLabel] = useState(existing?.label ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setSearching(false)
      return
    }

    setSearching(true)
    let cancelled = false
    const handle = setTimeout(() => {
      api
        .search(trimmed, type)
        .then((r) => {
          if (cancelled) return
          setResults(r)
          setSearchError(null)
        })
        .catch((error: ApiError) => {
          if (cancelled) return
          setResults([])
          // The UI must say metadata is unreachable, not hang (§10).
          setSearchError(
            error.code === 'provider_unavailable'
              ? "Can't reach the metadata service right now. Check the add-on's internet access and try again."
              : error.message,
          )
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, SEARCH_DEBOUNCE_MS)

    // A slow response for an older query must never overwrite a newer one.
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query, type])

  const pick = (preview: MetaPreview) => {
    setSelected(preview)
    setMetaError(null)
    if (preview.type === 'movie') {
      void save(preview, null, null)
      return
    }
    setStage('choose-scope')
  }

  const loadEpisodes = async (preview: MetaPreview) => {
    setStage('pick-episode')
    if (meta?.id === preview.id) return
    try {
      setMeta(await api.meta(existing?.provider ?? 'stremio', 'series', preview.id))
    } catch (error) {
      setMetaError((error as ApiError).message)
    }
  }

  const save = async (
    preview: MetaPreview,
    season: number | null,
    episode: number | null,
  ) => {
    setSaving(true)
    setSaveError(null)
    try {
      const payload = {
        content_type: preview.type,
        external_id: preview.id,
        title: preview.title,
        year: preview.year ?? null,
        poster_url: preview.poster ?? null,
        season,
        episode,
        label: label.trim() === '' ? null : label.trim(),
      }
      const card = existing
        ? await api.updateCard(existing.id, payload)
        : await api.createCard({ tag_uid: tagUid, ...payload })
      onSaved(card)
    } catch (error) {
      setSaveError((error as ApiError).message)
    } finally {
      setSaving(false)
    }
  }

  const seasons = useMemo(() => {
    const bySeason = new Map<number, Meta['videos']>()
    for (const video of meta?.videos ?? []) {
      const list = bySeason.get(video.season) ?? []
      list.push(video)
      bySeason.set(video.season, list)
    }
    // Season 0 is specials — last, matching the order the provider returns.
    const rank = (season: number) => (season === 0 ? Infinity : season)
    return [...bySeason.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
  }, [meta])

  if (stage === 'choose-scope' && selected) {
    return (
      <Sheet title={selected.title} onClose={onClose}>
        <p className="muted" style={{ marginBottom: 16 }}>
          What should this cartridge open?
        </p>
        <div className="stack">
          <button
            className="btn primary block"
            style={{ minHeight: 56 }}
            disabled={saving}
            onClick={() => void save(selected, null, null)}
          >
            Whole show
          </button>
          <p className="hint" style={{ marginTop: -4 }}>
            Opens the episode list on the TV. This is the usual choice — you pick a
            stream by hand anyway, and the card never goes stale.
          </p>
          <button className="btn block" onClick={() => void loadEpisodes(selected)}>
            Pick an episode
          </button>
        </div>
        {saveError ? <div className="banner error">{saveError}</div> : null}
      </Sheet>
    )
  }

  if (stage === 'pick-episode' && selected) {
    return (
      <Sheet
        title="Pick an episode"
        onClose={onClose}
        footer={
          <button className="btn block" onClick={() => setStage('choose-scope')}>
            Back
          </button>
        }
      >
        {metaError ? <div className="banner error">{metaError}</div> : null}
        {!meta && !metaError ? (
          <div className="center-empty">
            <div className="spinner" style={{ margin: '0 auto 10px' }} />
            Loading episodes…
          </div>
        ) : null}
        {seasons.map(([season, videos]) => (
          <div key={season} style={{ marginBottom: 18 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>
              {season === 0 ? 'Specials' : `Season ${season}`}
            </h3>
            <div className="list">
              {(videos ?? []).map((video) => (
                <button
                  key={video.id}
                  className="list-row"
                  disabled={saving}
                  onClick={() => void save(selected, video.season, video.episode)}
                >
                  <span className="pill">
                    {`S${String(video.season).padStart(2, '0')}E${String(video.episode).padStart(2, '0')}`}
                  </span>
                  <span className="grow">{video.title}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </Sheet>
    )
  }

  return (
    <Sheet
      title={existing ? `Change “${existing.title}”` : 'New cartridge'}
      onClose={onClose}
      footer={
        <button className="btn block" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <p className="muted mono" style={{ marginBottom: 14 }}>
        {tagUid}
      </p>

      <div className="row" style={{ marginBottom: 12 }}>
        <button
          className={`btn small ${type === 'movie' ? 'primary' : ''}`}
          onClick={() => setType('movie')}
        >
          Movie
        </button>
        <button
          className={`btn small ${type === 'series' ? 'primary' : ''}`}
          onClick={() => setType('series')}
        >
          Series
        </button>
      </div>

      <label className="field">
        <span>Title</span>
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Label (optional)</span>
        <input
          type="text"
          placeholder="e.g. blue cartridge"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>

      {searchError ? <div className="banner error">{searchError}</div> : null}
      {saveError ? <div className="banner error">{saveError}</div> : null}

      {searching ? (
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="spinner" />
          <span className="muted">Searching…</span>
        </div>
      ) : null}

      <div className="grid">
        {results.map((result) => (
          <button
            key={result.id}
            className="tile"
            disabled={saving}
            onClick={() => pick(result)}
          >
            <Poster src={result.poster} alt={result.title} />
            <div className="tile-body">
              <div className="tile-title">{result.title}</div>
              <div className="tile-sub">{result.year ?? ''}</div>
            </div>
          </button>
        ))}
      </div>

      {!searching && query.trim().length >= 2 && results.length === 0 && !searchError ? (
        <div className="center-empty">Nothing found for “{query.trim()}”.</div>
      ) : null}
    </Sheet>
  )
}
