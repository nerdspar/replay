import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { ArtworkPicker } from './ArtworkPicker'
import { AssignSheet } from './AssignSheet'
import { Confirm } from './Confirm'
import { Icon } from './Icon'
import { Poster, episodeBadge } from './Poster'
import { Sheet } from './Sheet'
import { StickerPreview } from './StickerPreview'
import { SpinePreview } from './SpinePreview'
import { readableTextColor, spineColors } from '../lib/spine'
import type { ArtFit, Card, EntityOption, SpineAlign } from '../types'

/** What each music content type is called in the open. */
const CONTENT_LABEL: Record<string, string> = {
  movie: 'Movie',
  series: 'Series',
  album: 'Album',
  artist: 'Artist',
  playlist: 'Playlist',
  track: 'Track',
  radio: 'Radio',
  podcast: 'Podcast',
  audiobook: 'Audiobook',
}

/**
 * Square cover art on a 2:3 sticker. Every option is full-bleed — the sticker
 * always reaches its own edges — they differ only in what fills the height a
 * square cover does not.
 */
const ART_FITS: { value: ArtFit; label: string; hint: string }[] = [
  {
    value: 'crop',
    label: 'Fill',
    hint: 'Zooms in and trims the top and bottom. Sharpest, but loses the edges of the cover.',
  },
  {
    value: 'blur',
    label: 'Blurred',
    hint: 'Shows the whole cover over a blurred copy of itself. Nothing is cut off.',
  },
  {
    value: 'color',
    label: 'Colour',
    hint: 'Shows the whole cover on a block of its own dominant colour.',
  },
]

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
  const [player, setPlayer] = useState<string | null>(card.player_entity)
  const [shuffle, setShuffle] = useState(card.shuffle)
  const [radioMode, setRadioMode] = useState(card.radio_mode)
  const [artFit, setArtFit] = useState<ArtFit>(card.art_fit ?? 'crop')
  /*
    Normalised to null rather than taken as-is. A card from an add-on that
    predates spine labels has no such field at all, and `undefined` would then
    differ from the `null` this state holds — leaving the sheet dirty the moment
    it opened and the reset button lit on a card with nothing to reset.
  */
  const [spineTextValue, setSpineTextValue] = useState(card.spine_text ?? '')
  const [spineColorValue, setSpineColorValue] = useState<string | null>(
    card.spine_color ?? null,
  )
  const [spineTextColorValue, setSpineTextColorValue] = useState<string | null>(
    card.spine_text_color ?? null,
  )
  /** The artwork's own colour, so "reset" has something to fall back to. */
  const [artworkSpineColor, setArtworkSpineColor] = useState('#ffffff')
  /*
    Typeface and alignment are global and set on the print screen, but the
    preview has to know them: where a title truncates depends on the face it is
    set in, so a preview using a different one would be quietly wrong.
  */
  const [spineStyle, setSpineStyle] = useState<{ font: string; align: SpineAlign }>({
    font: 'system',
    align: 'left',
  })

  useEffect(() => {
    void api
      .getSettings()
      .then((s) => setSpineStyle({ font: s.spine_font ?? 'system', align: s.spine_align ?? 'left' }))
      .catch(() => undefined)
  }, [])
  const [speakers, setSpeakers] = useState<EntityOption[]>([])
  const [playing, setPlaying] = useState(false)
  const [playResult, setPlayResult] = useState<{ ok: boolean; message: string } | null>(null)

  const music = card.kind === 'music'
  const device = music ? 'speaker' : 'TV'

  useEffect(() => {
    if (!music) return
    api
      .entities()
      .then((e) => setSpeakers(e.musicPlayers))
      .catch(() => setSpeakers([]))
  }, [music])

  /*
    The colour the spine takes when nothing has been chosen for it.

    Resolved against a copy with the override stripped, so it stays the
    artwork's answer rather than echoing whatever is currently set — otherwise
    "reset to artwork" would reset to the override.
  */
  useEffect(() => {
    let cancelled = false
    void spineColors({ ...card, spine_color: null, spine_text_color: null })
      .then((resolved) => {
        if (!cancelled) setArtworkSpineColor(resolved.background)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [card])

  const effectiveSpineColor = spineColorValue ?? artworkSpineColor
  const effectiveSpineTextColor =
    spineTextColorValue ?? readableTextColor(effectiveSpineColor)

  const playNow = async () => {
    setPlaying(true)
    setPlayResult(null)
    try {
      const result = await api.testCard(card.id)
      setPlayResult(
        result.ok
          ? {
              ok: true,
              message: music
                ? 'Sent to the speaker. It should be playing now.'
                : 'Sent to the TV. It should be opening now.',
            }
          : {
              ok: false,
              // The scan log records why, which is more use than "it failed".
              message: result.scan.error ?? `The ${device} did not accept it.`,
            },
      )
    } catch (e) {
      setPlayResult({ ok: false, message: (e as ApiError).message })
    } finally {
      setPlaying(false)
    }
  }

  const dirty =
    poster !== card.poster_url ||
    label !== (card.label ?? '') ||
    player !== card.player_entity ||
    shuffle !== card.shuffle ||
    radioMode !== card.radio_mode ||
    artFit !== (card.art_fit ?? 'crop') ||
    spineTextValue !== (card.spine_text ?? '') ||
    spineColorValue !== (card.spine_color ?? null) ||
    spineTextColorValue !== (card.spine_text_color ?? null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      onChanged(
        await api.updateCard(card.id, {
          poster_url: poster,
          label: label.trim() === '' ? null : label.trim(),
          // Null rather than '' throughout: it means "follow the artwork", so
          // clearing a field restores the default instead of printing a blank.
          spine_text: spineTextValue.trim() === '' ? null : spineTextValue.trim(),
          spine_color: spineColorValue,
          spine_text_color: spineTextColorValue,
          ...(music
            ? {
                player_entity: player,
                shuffle,
                radio_mode: radioMode,
                art_fit: artFit,
              }
            : {}),
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
            kind={card.kind}
            fit={card.art_fit}
            card={card}
            badge={episodeBadge(card.season, card.episode)}
          />
        </div>
        <div className="grow">
          <strong>{card.title}</strong>
          <p className="hint" style={{ marginTop: 2 }}>
            {[card.year, CONTENT_LABEL[card.content_type] ?? card.content_type]
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

      {/*
        The same thing tapping the cartridge does, for when the cartridge is not
        to hand — checking a new assignment from the sofa, or confirming the TV
        still answers. Not a debug tool: it is the normal way to play something
        without getting up.
      */}
      {card.status === 'assigned' ? (
        <>
          <button
            className="btn primary block"
            disabled={playing}
            onClick={() => void playNow()}
          >
            {playing ? (
              <>
                <div className="spinner" />
                {music ? 'Sending to the speaker…' : 'Sending to the TV…'}
              </>
            ) : (
              <>
                <Icon name={music ? 'music' : 'play'} size={18} />
                {music ? 'Play on the speaker' : 'Play on the TV'}
              </>
            )}
          </button>
          {playResult ? (
            <p className={`hint ${playResult.ok ? '' : 'warn'}`}>{playResult.message}</p>
          ) : (
            <p className="hint">
              Runs exactly what a tap on the reader does, so it is also how you
              check the {device} is still responding.
            </p>
          )}
        </>
      ) : null}

      <h3 style={{ fontSize: 15, margin: '24px 0 8px' }}>Artwork</h3>
      <ArtworkPicker
        provider={card.provider}
        contentType={card.content_type}
        externalId={card.external_id}
        season={card.season}
        episode={card.episode}
        value={poster}
        originalUrl={card.original_poster_url}
        onChange={setPoster}
      />

      {music ? (
        <>
          <h3 style={{ fontSize: 15, margin: '24px 0 8px' }}>How it plays</h3>

          <label className="field">
            <span>Speaker</span>
            <select
              value={player ?? ''}
              onChange={(e) => setPlayer(e.target.value === '' ? null : e.target.value)}
            >
              <option value="">Use the default</option>
              {speakers.map((entity) => (
                <option key={entity.entity_id} value={entity.entity_id}>
                  {entity.name}
                </option>
              ))}
            </select>
            <p className="hint">
              Leave this alone unless this one cartridge belongs in a different
              room from everything else.
            </p>
          </label>

          <div className="switch">
            <span>Shuffle</span>
            <input
              type="checkbox"
              checked={shuffle}
              onChange={(e) => setShuffle(e.target.checked)}
            />
          </div>
          <p className="hint">Plays in a random order instead of the running order.</p>

          <div className="switch">
            <span>Keep going afterwards</span>
            <input
              type="checkbox"
              checked={radioMode}
              onChange={(e) => setRadioMode(e.target.checked)}
            />
          </div>
          <p className="hint">
            When this finishes, carries on with similar music instead of falling
            silent.
          </p>

          <h3 style={{ fontSize: 15, margin: '24px 0 8px' }}>On the sticker</h3>
          <div className="sticker-choice">
            <StickerPreview card={card} fit={artFit} poster={poster} />
            <div className="radio-list grow">
            {ART_FITS.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name="art-fit"
                  checked={artFit === option.value}
                  onChange={() => setArtFit(option.value)}
                />
                <span>
                  {option.label}
                  <span className="hint" style={{ display: 'block' }}>
                    {option.hint}
                  </span>
                </span>
                </label>
              ))}
            </div>
          </div>
          <p className="hint">
            Cover art is square and the cartridge sticker is taller than it is
            wide, so something has to give.
          </p>
        </>
      ) : null}

      {/*
        Outside the music block above: every cartridge has an edge, whatever it
        plays. The colour follows the artwork until it is overridden, so most
        cartridges never need this opened at all.
      */}
      <h3 style={{ fontSize: 15, margin: '24px 0 8px' }}>On the spine</h3>
      <SpinePreview
        text={spineTextValue.trim() === '' ? card.title : spineTextValue}
        background={effectiveSpineColor}
        textColor={effectiveSpineTextColor}
        font={spineStyle.font}
        align={spineStyle.align}
      />
      <p className="hint" style={{ marginTop: 6 }}>
        Typeface and alignment are the same for every cartridge, and are chosen
        on the print screen.
      </p>

      <label className="field" style={{ marginTop: 12 }}>
        <span>Spine text</span>
        <input
          type="text"
          placeholder={card.title}
          value={spineTextValue}
          onChange={(e) => setSpineTextValue(e.target.value)}
        />
        <p className="hint">
          Empty follows the title. There is room for about 25 characters, so a
          long one is worth shortening by hand.
        </p>
      </label>

      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <label className="field grow" style={{ marginBottom: 0 }}>
          <span>Background</span>
          <input
            type="color"
            value={effectiveSpineColor}
            onChange={(e) => setSpineColorValue(e.target.value)}
          />
        </label>
        <label className="field grow" style={{ marginBottom: 0 }}>
          <span>Text</span>
          <input
            type="color"
            value={effectiveSpineTextColor}
            onChange={(e) => setSpineTextColorValue(e.target.value)}
          />
        </label>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button
          className="btn small"
          disabled={spineColorValue === null && spineTextColorValue === null}
          onClick={() => {
            setSpineColorValue(null)
            setSpineTextColorValue(null)
          }}
        >
          <Icon name="undo" size={16} />
          Back to the artwork's colour
        </button>
      </div>
      <p className="hint">
        {spineColorValue === null
          ? 'Taken from the artwork, and follows it if you change the cover.'
          : 'Set by hand. It will stay this colour if you change the cover.'}
        {spineTextColorValue === null
          ? ' The text picks black or white for legibility.'
          : ' The text colour is set by hand.'}
      </p>

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
          Removes it from the library completely. Tap it on the reader to add it
          back.
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
          body="It disappears from your library completely. If you still have the cartridge, tap it on the reader to add it back."
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
