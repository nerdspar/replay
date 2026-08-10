import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { AssignSheet } from '../components/AssignSheet'
import { CardSheet } from '../components/CardSheet'
import { Confirm } from '../components/Confirm'
import { Icon } from '../components/Icon'
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
  const [pendingAction, setPendingAction] = useState<'unassign' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)

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

  /** Runs a destructive action over the current selection, then reports. */
  const applyToSelected = async (
    action: (card: Card) => Promise<unknown>,
    describe: (n: number) => string,
  ) => {
    const targets = cards.filter((c) => selected.has(c.id))
    setBusy(true)

    const failures: string[] = []
    for (const card of targets) {
      try {
        await action(card)
      } catch {
        failures.push(card.title)
      }
    }

    setBusy(false)
    setPendingAction(null)
    stopSelecting()
    refresh()
    setToast(
      failures.length > 0
        ? `Could not finish: ${failures.join(', ')}`
        : describe(targets.length - failures.length),
    )
    setTimeout(() => setToast(null), 5000)
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
                    className="btn small"
                    disabled={selected.size === 0}
                    onClick={() => setPendingAction('unassign')}
                  >
                    Empty
                  </button>
                  <button
                    className="btn small danger"
                    disabled={selected.size === 0}
                    onClick={() => setPendingAction('delete')}
                  >
                    Delete
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
                {/*
                  An emptied cartridge shows its tag instead of artwork — it is
                  a thing you still own that currently plays nothing.
                */}
                {card.status === 'unassigned' ? (
                  <div className="poster empty-cartridge">
                    <Icon name="library" size={30} />
                    <span className="mono">{card.tag_uid}</span>
                    <span className="hint">Empty</span>
                  </div>
                ) : (
                  <Poster
                    src={card.poster_url}
                    alt={card.title}
                    badge={episodeBadge(card.season, card.episode)}
                  />
                )}
                {selecting ? (
                  <span className="tick">
                    {selected.has(card.id) ? <Icon name="check" size={16} /> : null}
                  </span>
                ) : null}
                <div className="tile-body">
                  <div className="tile-title">
                    {card.status === 'unassigned' ? 'Empty cartridge' : card.title}
                  </div>
                  <div className="tile-sub">
                    {card.status === 'unassigned'
                      ? card.label ?? 'Tap it on the reader to fill it'
                      : [card.year, card.label].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {selecting ? null : (
                  <div className="tile-actions">
                    {card.status === 'unassigned' ? (
                      <button
                        className="btn small"
                        onClick={() => setAssigning({ uid: card.tag_uid })}
                      >
                        Fill it
                      </button>
                    ) : (
                      <button
                        className="btn small"
                        disabled={testing === card.id}
                        onClick={() => void runTest(card)}
                      >
                        {testing === card.id ? '…' : 'Test'}
                      </button>
                    )}
                    <button className="btn small" onClick={() => setEditing(card)}>
                      Edit
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
          onChanged={() => {
            setEditing(null)
            refresh()
          }}
        />
      ) : null}

      {pendingAction === 'unassign' ? (
        <Confirm
          title={`Empty ${selected.size} cartridge${selected.size === 1 ? '' : 's'}?`}
          body="They stay in your library as blank cartridges, showing their tag instead of artwork. Tap one on the reader to give it something new."
          confirmLabel="Empty"
          busy={busy}
          onCancel={() => setPendingAction(null)}
          onConfirm={() =>
            void applyToSelected(
              (card) => api.unassignCard(card.id),
              (n) => `Emptied ${n} cartridge${n === 1 ? '' : 's'}.`,
            )
          }
        />
      ) : null}

      {pendingAction === 'delete' ? (
        <Confirm
          title={`Delete ${selected.size} cartridge${selected.size === 1 ? '' : 's'}?`}
          body="This removes them from your library completely. Use it when a cartridge is lost or its tag is damaged — if you still have it, empty it instead."
          confirmLabel="Delete"
          destructive
          busy={busy}
          onCancel={() => setPendingAction(null)}
          onConfirm={() =>
            void applyToSelected(
              (card) => api.deleteCard(card.id),
              (n) => `Deleted ${n} cartridge${n === 1 ? '' : 's'}.`,
            )
          }
        />
      ) : null}
    </>
  )
}
