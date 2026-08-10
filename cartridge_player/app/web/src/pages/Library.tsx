import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { AssignSheet } from '../components/AssignSheet'
import { CardSheet } from '../components/CardSheet'
import { Poster, episodeBadge } from '../components/Poster'
import type { AppStream } from '../hooks/useAppStream'
import type { Card, ScanEvent } from '../types'

interface LibraryProps {
  stream: AppStream
}

/** §8.4 — poster grid, per-card Test / Edit / Unassign, unassigned strip on top. */
export function Library({ stream }: LibraryProps) {
  const navigate = useNavigate()
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [assigning, setAssigning] = useState<{ uid: string; existing?: Card } | null>(null)
  const [editing, setEditing] = useState<Card | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [selecting, setSelecting] = useState(false)
  const [query, setQuery] = useState('')

  // Matches title, label, and year, so "blue cartridge" finds it by the note
  // written on the side as readily as by the film's name.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return cards
    return cards.filter((card) =>
      [card.title, card.label, card.year]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [cards, query])
  const [testing, setTesting] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [recentUnassigned, setRecentUnassigned] = useState<string[]>([])

  const refresh = useCallback(() => {
    api
      .listCards()
      .then((next) => {
        setCards(next)
        setError(null)
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(refresh, [refresh, stream.cardsVersion])

  // Cartridges seen but never assigned. Derived from the scan log so they
  // survive a page reload, unlike the single live pending UID.
  useEffect(() => {
    api
      .scans(100)
      .then(({ scans }) => {
        const assigned = new Set(cards.map((c) => c.tag_uid))
        const seen: string[] = []
        for (const scan of scans as ScanEvent[]) {
          if (scan.matched_card_id !== null) continue
          if (assigned.has(scan.tag_uid) || seen.includes(scan.tag_uid)) continue
          seen.push(scan.tag_uid)
        }
        setRecentUnassigned(seen.slice(0, 8))
      })
      .catch(() => setRecentUnassigned([]))
  }, [cards, stream.lastScan])

  const runTest = async (card: Card) => {
    setTesting(card.id)
    try {
      const result = await api.testCard(card.id)
      setToast(
        result.ok
          ? `Sent “${card.title}” to the TV.`
          : `Failed: ${result.scan.error ?? 'unknown error'}`,
      )
    } catch (e) {
      setToast((e as ApiError).message)
    } finally {
      setTesting(null)
      setTimeout(() => setToast(null), 4000)
    }
  }

  const toggleOne = (id: number) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Acts on what is currently visible, so "All" after a search means "all of
  // these", not "all hundred".
  const toggleAll = () =>
    setSelected((current) =>
      current.size === visible.length ? new Set() : new Set(visible.map((c) => c.id)),
    )

  const stopSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  const printSelected = () => {
    navigate(`/print?ids=${[...selected].join(',')}`)
  }

  const unassign = async (card: Card) => {
    if (!window.confirm(`Unassign “${card.title}”? The cartridge itself is untouched.`)) return
    await api.deleteCard(card.id)
    refresh()
  }

  const unassignSelected = async () => {
    const targets = cards.filter((c) => selected.has(c.id))
    if (targets.length === 0) return
    if (
      !window.confirm(
        `Unassign ${targets.length} cartridge${targets.length === 1 ? '' : 's'}? ` +
          'The cartridges themselves are untouched, and can be reassigned by tapping them.',
      )
    ) {
      return
    }

    const failures: string[] = []
    for (const card of targets) {
      try {
        await api.deleteCard(card.id)
      } catch {
        failures.push(card.title)
      }
    }

    stopSelecting()
    refresh()
    if (failures.length > 0) {
      setToast(`Could not unassign: ${failures.join(', ')}`)
      setTimeout(() => setToast(null), 5000)
    }
  }

  return (
    <>
      {stream.pending ? (
        <div className="banner alert">
          <div className="row between" style={{ marginBottom: 10 }}>
            <strong>New cartridge detected</strong>
            <span className="mono">{stream.pending.uid}</span>
          </div>
          <div className="row">
            <button
              className="btn primary"
              style={{ flex: 1 }}
              onClick={() => setAssigning({ uid: stream.pending!.uid })}
            >
              Choose what it plays
            </button>
            <button className="btn" onClick={stream.dismissPending}>
              Not now
            </button>
          </div>
        </div>
      ) : null}

      {toast ? <div className="banner alert">{toast}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}

      {recentUnassigned.length > 0 ? (
        <>
          <p className="hint" style={{ marginBottom: 6 }}>
            Seen but not assigned
          </p>
          <div className="strip">
            {recentUnassigned.map((uid) => (
              <button key={uid} className="chip" onClick={() => setAssigning({ uid })}>
                <span aria-hidden="true">＋</span>
                {uid}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {loading ? (
        <div className="center-empty">
          <div className="spinner" style={{ margin: '0 auto 10px' }} />
          Loading your library…
        </div>
      ) : cards.length === 0 ? (
        <div className="center-empty">
          <p style={{ fontSize: 40, margin: 0 }}>🎞</p>
          <p>No cartridges yet.</p>
          <p className="hint">Tap one on the reader and it will show up here.</p>
        </div>
      ) : (
        <>
          {cards.length > 6 ? (
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Search your cartridges…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ marginBottom: 12 }}
            />
          ) : null}

          <div className="row between" style={{ marginBottom: 12 }}>
            {selecting ? (
              <>
                <span className="muted">{selected.size} selected</span>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn small" onClick={toggleAll}>
                    {selected.size === visible.length ? 'None' : 'All'}
                  </button>
                  <button className="btn small" onClick={stopSelecting}>
                    Cancel
                  </button>
                  <button
                    className="btn small danger"
                    disabled={selected.size === 0}
                    onClick={() => void unassignSelected()}
                  >
                    Unassign
                  </button>
                  <button
                    className="btn small primary"
                    disabled={selected.size === 0}
                    onClick={printSelected}
                  >
                    Stickers
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="muted">
                  {query.trim() === ''
                    ? `${cards.length} cartridge${cards.length === 1 ? '' : 's'}`
                    : `${visible.length} of ${cards.length}`}
                </span>
                <button className="btn small" onClick={() => setSelecting(true)}>
                  Select
                </button>
              </>
            )}
          </div>

          {visible.length === 0 ? (
            <div className="center-empty">
              <p>Nothing matches “{query.trim()}”.</p>
              <button className="btn small" onClick={() => setQuery('')}>
                Clear search
              </button>
            </div>
          ) : null}

          <div className="grid">
            {visible.map((card) => (
              <div
                key={card.id}
                className={`tile ${selecting && selected.has(card.id) ? 'picked' : ''}`}
                style={{ cursor: selecting ? 'pointer' : 'default' }}
                onClick={selecting ? () => toggleOne(card.id) : undefined}
              >
                <Poster
                  src={card.poster_url}
                  alt={card.title}
                  badge={episodeBadge(card.season, card.episode)}
                />
                {selecting ? (
                  <span className="tick" aria-hidden="true">
                    {selected.has(card.id) ? '✓' : ''}
                  </span>
                ) : null}
                <div className="tile-body">
                  <div className="tile-title">{card.title}</div>
                  <div className="tile-sub">
                    {[card.year, card.label].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {selecting ? null : (
                  <div className="tile-actions">
                    <button
                      className="btn small"
                      disabled={testing === card.id}
                      onClick={() => void runTest(card)}
                    >
                      {testing === card.id ? '…' : 'Test'}
                    </button>
                    <button className="btn small" onClick={() => setEditing(card)}>
                      Edit
                    </button>
                    <button className="btn small danger" onClick={() => void unassign(card)}>
                      ✕
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {assigning ? (
        <AssignSheet
          tagUid={assigning.uid}
          existing={assigning.existing ?? null}
          onClose={() => setAssigning(null)}
          onSaved={() => {
            setAssigning(null)
            stream.dismissPending()
            refresh()
          }}
        />
      ) : null}

      {editing ? (
        <CardSheet
          card={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            refresh()
          }}
        />
      ) : null}
    </>
  )
}
