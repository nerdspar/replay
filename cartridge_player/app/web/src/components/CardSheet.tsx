import { useState } from 'react'
import { api, ApiError } from '../api'
import { ArtworkPicker } from './ArtworkPicker'
import { AssignSheet } from './AssignSheet'
import { Confirm } from './Confirm'
import { Icon } from './Icon'
import { Poster, episodeBadge } from './Poster'
import { Sheet } from './Sheet'
import type { Card } from '../types'

interface CardSheetProps {
  card: Card
  onClose: () => void
  /** Fired after any change — a save, an empty, or a delete. */
  onChanged: (card: Card | null) => void
}

/**
 * Editing an existing cartridge: artwork, label, and — if the show itself is
 * wrong — a way back into the assignment flow. Kept separate from AssignSheet so
 * changing a poster does not mean searching for the title again.
 */
export function CardSheet({ card, onClose, onChanged }: CardSheetProps) {
  const [poster, setPoster] = useState<string | null>(card.poster_url)
  const [label, setLabel] = useState(card.label ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changingMedia, setChangingMedia] = useState(false)
  const [confirming, setConfirming] = useState<'unassign' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)

  const dirty = poster !== card.poster_url || label !== (card.label ?? '')

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      onChanged(
        await api.updateCard(card.id, {
          poster_url: poster,
          label: label.trim() === '' ? null : label.trim(),
        }),
      )
    } catch (e) {
      setError((e as ApiError).message)
      setSaving(false)
    }
  }

  /** Shared by empty and delete: both finish by closing and refreshing. */
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged(null)
    } catch (e) {
      setError((e as ApiError).message)
      setBusy(false)
      setConfirming(null)
    }
  }

  if (changingMedia) {
    return (
      <AssignSheet
        tagUid={card.tag_uid}
        existing={card}
        onClose={() => setChangingMedia(false)}
        onSaved={onChanged}
      />
    )
  }

  return (
    <Sheet
      title={card.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error ? <div className="banner error">{error}</div> : null}

      <div className="row" style={{ alignItems: 'flex-start', marginBottom: 18 }}>
        <div style={{ width: 96, flex: 'none' }}>
          <Poster
            src={poster}
            alt={card.title}
            badge={episodeBadge(card.season, card.episode)}
          />
        </div>
        <div className="grow">
          <strong>{card.title}</strong>
          <p className="hint" style={{ marginTop: 2 }}>
            {[card.year, card.content_type === 'series' ? 'Series' : 'Movie']
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="mono hint">{card.tag_uid}</p>
          <button
            className="btn small"
            style={{ marginTop: 8 }}
            onClick={() => setChangingMedia(true)}
          >
            Change what this plays
          </button>
        </div>
      </div>

      <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>Artwork</h3>
      <ArtworkPicker
        provider={card.provider}
        contentType={card.content_type}
        externalId={card.external_id}
        season={card.season}
        episode={card.episode}
        value={poster}
        onChange={setPoster}
      />

      <label className="field" style={{ marginTop: 18 }}>
        <span>Label (optional)</span>
        <input
          type="text"
          placeholder="e.g. blue cartridge"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>

      <div className="danger-zone">
        {card.status === 'assigned' ? (
          <>
            <button className="btn block" onClick={() => setConfirming('unassign')}>
              <Icon name="eject" size={17} />
              Empty this cartridge
            </button>
            <p className="hint">
              Clears what it plays but keeps the cartridge, so you can put
              something else on it later.
            </p>
          </>
        ) : null}

        <button
          className="btn block danger"
          style={{ marginTop: 12 }}
          onClick={() => setConfirming('delete')}
        >
          <Icon name="trash" size={17} />
          Delete this cartridge
        </button>
        <p className="hint">
          Removes it from the library completely. For a cartridge you have lost,
          or one whose tag has stopped working.
        </p>
      </div>

      {confirming === 'unassign' ? (
        <Confirm
          title={`Empty “${card.title}”?`}
          body="The cartridge stays in your library as a blank one, showing its tag instead of artwork. Tap it on the reader to give it something new."
          confirmLabel="Empty"
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void run(() => api.unassignCard(card.id))}
        />
      ) : null}

      {confirming === 'delete' ? (
        <Confirm
          title={`Delete “${card.title}”?`}
          body="This removes the cartridge from your library completely. If you still have it, empty it instead — that keeps it ready to reuse."
          confirmLabel="Delete"
          destructive
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void run(() => api.deleteCard(card.id))}
        />
      ) : null}
    </Sheet>
  )
}
