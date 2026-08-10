import { useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from '../api'
import { AssignSheet } from '../components/AssignSheet'
import type { AppStream } from '../hooks/useAppStream'
import type { EntityOption, Settings } from '../types'

interface WizardProps {
  settings: Settings
  stream: AppStream
  onDone: (settings: Settings) => void
}

interface Step {
  id: string
  title: string
  render: () => ReactNode
  /** Whether the user may advance from this step. */
  canAdvance: boolean
  nextLabel?: string
}

/**
 * §8.3 — an ordered step list, deliberately, so the deferred device-type and
 * content-source steps (§12.2) can be inserted later without a rewrite. There is
 * only one of each in v1, so neither step exists yet.
 */
export function Wizard({ settings, stream, onDone }: WizardProps) {
  const [index, setIndex] = useState(0)
  const [remotes, setRemotes] = useState<EntityOption[]>([])
  const [remoteEntity, setRemoteEntity] = useState(settings.remote_entity ?? '')
  const [mediaPlayerEntity, setMediaPlayerEntity] = useState(
    settings.media_player_entity ?? '',
  )
  const [mediaPlayers, setMediaPlayers] = useState<EntityOption[]>([])
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [assigning, setAssigning] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    api
      .entities()
      .then(({ remotes: r, mediaPlayers: m }) => {
        setRemotes(r)
        setMediaPlayers(m)
        // A single obvious candidate is worth preselecting for a non-technical user.
        if (!remoteEntity && r.length === 1 && r[0]) setRemoteEntity(r[0].entity_id)
      })
      .catch((e: ApiError) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveRemote = async () => {
    await api.saveSettings({
      remote_entity: remoteEntity || null,
      media_player_entity: mediaPlayerEntity || null,
    })
  }

  const sendTest = async () => {
    setTestState('sending')
    setError(null)
    try {
      await api.sendKey('home')
      setTestState('sent')
    } catch (e) {
      setTestState('failed')
      setError((e as ApiError).message)
    }
  }

  const finish = async () => {
    setFinishing(true)
    try {
      onDone(await api.saveSettings({ setup_complete: true }))
    } catch (e) {
      setError((e as ApiError).message)
      setFinishing(false)
    }
  }

  const steps: Step[] = [
    {
      id: 'tv',
      title: 'Pick your TV',
      canAdvance: remoteEntity !== '',
      render: () => (
        <>
          <label className="field">
            <span>Remote</span>
            <select value={remoteEntity} onChange={(e) => setRemoteEntity(e.target.value)}>
              <option value="">Choose…</option>
              {remotes.map((entity) => (
                <option key={entity.entity_id} value={entity.entity_id}>
                  {entity.name}
                </option>
              ))}
            </select>
            <p className="hint">
              This list comes from the Android TV Remote integration. If it is empty,
              add your TV in Home Assistant first.
            </p>
          </label>

          <label className="field">
            <span>Media player (optional)</span>
            <select
              value={mediaPlayerEntity}
              onChange={(e) => setMediaPlayerEntity(e.target.value)}
            >
              <option value="">Skip for now</option>
              {mediaPlayers.map((entity) => (
                <option key={entity.entity_id} value={entity.entity_id}>
                  {entity.name}
                </option>
              ))}
            </select>
            <p className="hint">Only needed if you want pausing to work.</p>
          </label>
        </>
      ),
    },
    {
      id: 'test',
      title: 'Test it',
      canAdvance: testState === 'sent',
      nextLabel: 'Yes, it reacted',
      render: () => (
        <>
          <p className="muted">
            This sends the Home button to your TV. Watch the screen — it should wake up
            or jump to its home screen.
          </p>
          <button
            className="btn primary block"
            style={{ marginTop: 16 }}
            disabled={testState === 'sending'}
            onClick={() => void sendTest()}
          >
            {testState === 'sending' ? 'Sending…' : 'Send Home to the TV'}
          </button>
          {testState === 'sent' ? (
            <p className="hint" style={{ marginTop: 12 }}>
              Sent. Did the TV react? If not, go back and pick a different remote.
            </p>
          ) : null}
        </>
      ),
    },
    {
      id: 'first-card',
      title: 'Scan your first cartridge',
      canAdvance: true,
      nextLabel: 'Finish',
      render: () => (
        <>
          <p className="muted">Hold a cartridge against the reader.</p>
          <div className="card" style={{ marginTop: 16, textAlign: 'center' }}>
            {stream.pending ? (
              <>
                <p style={{ fontSize: 32, margin: 0 }}>🎉</p>
                <p style={{ margin: '8px 0 0' }}>Got it</p>
                <p className="mono">{stream.pending.uid}</p>
                <button
                  className="btn primary block"
                  style={{ marginTop: 14 }}
                  onClick={() => setAssigning(stream.pending!.uid)}
                >
                  Choose what it plays
                </button>
              </>
            ) : (
              <>
                <div className="spinner" style={{ margin: '8px auto 12px' }} />
                <p className="muted">Waiting for a cartridge…</p>
                <p className="hint">
                  {stream.connection === 'connected'
                    ? 'Connected to Home Assistant.'
                    : `Home Assistant: ${stream.connection}.`}
                </p>
              </>
            )}
          </div>
          <p className="hint" style={{ marginTop: 12 }}>
            You can also finish now and assign cartridges later.
          </p>
        </>
      ),
    },
  ]

  const step = steps[index]!
  const isLast = index === steps.length - 1

  const advance = async () => {
    setError(null)
    if (step.id === 'tv') {
      try {
        await saveRemote()
      } catch (e) {
        setError((e as ApiError).message)
        return
      }
    }
    if (isLast) {
      await finish()
      return
    }
    setIndex((i) => i + 1)
  }

  return (
    <>
      <div className="steps">
        {steps.map((s, i) => (
          <div key={s.id} className={`step ${i <= index ? 'done' : ''}`} />
        ))}
      </div>

      <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>{step.title}</h2>
      <p className="hint" style={{ marginBottom: 16 }}>
        Step {index + 1} of {steps.length}
      </p>

      {error ? <div className="banner error">{error}</div> : null}

      {step.render()}

      <div className="row" style={{ marginTop: 24, gap: 10 }}>
        {index > 0 ? (
          <button className="btn" onClick={() => setIndex((i) => i - 1)}>
            Back
          </button>
        ) : null}
        <button
          className="btn primary"
          style={{ flex: 1 }}
          disabled={!step.canAdvance || finishing}
          onClick={() => void advance()}
        >
          {finishing ? 'Finishing…' : (step.nextLabel ?? 'Next')}
        </button>
      </div>

      {assigning ? (
        <AssignSheet
          tagUid={assigning}
          onClose={() => setAssigning(null)}
          onSaved={() => {
            setAssigning(null)
            stream.dismissPending()
            void finish()
          }}
        />
      ) : null}
    </>
  )
}
