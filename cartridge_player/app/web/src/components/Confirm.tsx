import { useEffect, useRef } from 'react'

export interface ConfirmProps {
  title: string
  /** What will actually happen. Plain language, no jargon. */
  body: string
  confirmLabel: string
  /** Styles the action as destructive. */
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}

/**
 * Replaces `window.confirm` for anything destructive.
 *
 * The native dialog is wrong here twice over: it looks nothing like the rest of
 * the app on a phone, and a standalone home-screen install can suppress it
 * entirely — which would mean a delete happening with no prompt at all.
 */
export function Confirm({
  title,
  body,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
  busy,
}: ConfirmProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // Focus lands on Cancel, not on the destructive action.
    cancelRef.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onCancel])

  return (
    <div
      className="sheet-backdrop confirm-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div className="confirm" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <p className="muted">{body}</p>
        <div className="confirm-actions">
          <button ref={cancelRef} className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={`btn ${destructive ? 'destructive' : 'primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
