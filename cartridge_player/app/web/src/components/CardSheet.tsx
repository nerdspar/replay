import { useState } from 'react'
import { api, ApiError } from '../api'
import { ArtworkPicker } from './ArtworkPicker'
import { AssignSheet } from './AssignSheet'
import { Poster, episodeBadge } from './Poster'
import { Sheet } from './Sheet'
import type { Card } from '../types'

interface CardSheetProps {
  card: Card
  onClose: () => void
  onSaved: (card: Card) => void
}

/**
 * Editing an existing cartridge: artwork, label, and — if the show itself is
 * wrong — a way back into the assignment flow. Kept separate from AssignSheet so
 * changing a poster does not mean searching for the title again.
 */
export function CardSheet({ card, onClose, onSaved }: CardSheetProps) {
  const [poster, setPoster] = useState<string | null>(card.poster_url)
  const [label, setLabel] = useState(card.label ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changingMedia, setChangingMedia] = useState(false)

  const dirty = poster !== card.poster_url || label !== (card.label ?? '')

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      onSaved(
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

  if (changingMedia) {
    return (
      <AssignSheet
        tagUid={card.tag_uid}
        existing={card}
        onClose={() => setChangingMedia(false)}
        onSaved={onSaved}
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
    </Sheet>
  )
}
