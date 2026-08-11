import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type {
  AppEvent,
  Card,
  ConnectionState,
  PendingUid,
  ScanEvent,
  SeatedCartridge,
} from '../types'

const EVENT_TYPES = ['pending', 'scan', 'connection', 'cards', 'error', 'seated'] as const

export interface AppStream {
  /** Home Assistant WebSocket state, as reported by the server. */
  connection: ConnectionState
  connectionDetail?: string
  /** Whether OUR SSE connection to the add-on is alive. */
  streamAlive: boolean
  pending: PendingUid | null
  /** The cartridge physically on the reader, and what it is doing. */
  seated: SeatedCartridge | null
  lastScan: { scan: ScanEvent; card: Card | null } | null
  lastError: string | null
  /** Bumped whenever the library changes — components refetch off this. */
  cardsVersion: number
  dismissPending: () => void
  reconnect: () => void
}

/**
 * The assignment flow depends on SSE pushing the unknown UID to the browser, and
 * iOS Safari kills connections when a tab backgrounds. The user opening the app,
 * walking to the reader, and tapping a card is the NORMAL path — so on every
 * return to visibility we rebuild the stream and immediately poll `api/pending`
 * to catch whatever arrived while we were away (§8.2).
 */
export function useAppStream(): AppStream {
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [connectionDetail, setConnectionDetail] = useState<string | undefined>()
  const [streamAlive, setStreamAlive] = useState(false)
  const [pending, setPending] = useState<PendingUid | null>(null)
  const [seated, setSeated] = useState<SeatedCartridge | null>(null)
  const [lastScan, setLastScan] = useState<{ scan: ScanEvent; card: Card | null } | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [cardsVersion, setCardsVersion] = useState(0)

  const sourceRef = useRef<EventSource | null>(null)
  const dismissedRef = useRef<string | null>(null)

  const applyPending = useCallback((next: PendingUid | null) => {
    setPending(next && dismissedRef.current === next.uid ? null : next)
  }, [])

  const handle = useCallback(
    (event: AppEvent) => {
      switch (event.type) {
        case 'seated':
          setSeated(event.seated)
          break

        case 'pending':
          applyPending(event.pending)
          break
        case 'scan':
          setLastScan({ scan: event.scan, card: event.card })
          if (event.scan.error) setLastError(event.scan.error)
          break
        case 'connection':
          setConnection(event.state)
          setConnectionDetail(event.detail)
          break
        case 'cards':
          setCardsVersion((v) => v + 1)
          break
        case 'error':
          setLastError(event.message)
          break
      }
    },
    [applyPending],
  )

  const connect = useCallback(() => {
    sourceRef.current?.close()

    const source = new EventSource('api/events')
    sourceRef.current = source

    source.onopen = () => setStreamAlive(true)
    source.onerror = () => setStreamAlive(false)

    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (message) => {
        try {
          handle(JSON.parse((message as MessageEvent<string>).data) as AppEvent)
        } catch {
          /* ignore malformed frame */
        }
      })
    }
  }, [handle])

  const resync = useCallback(() => {
    api
      .pending()
      .then((result) => {
        applyPending(result.pending)
        setSeated(result.seated)
        setConnection(result.connection.state as ConnectionState)
        setConnectionDetail(result.connection.detail)
      })
      .catch(() => setStreamAlive(false))
  }, [applyPending])

  useEffect(() => {
    connect()
    resync()

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      connect()
      resync()
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onVisible)
    window.addEventListener('online', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onVisible)
      window.removeEventListener('online', onVisible)
      sourceRef.current?.close()
      sourceRef.current = null
    }
  }, [connect, resync])

  const dismissPending = useCallback(() => {
    dismissedRef.current = pending?.uid ?? null
    setPending(null)
  }, [pending])

  const reconnect = useCallback(() => {
    connect()
    resync()
  }, [connect, resync])

  return {
    connection,
    connectionDetail,
    streamAlive,
    pending,
    seated,
    lastScan,
    lastError,
    cardsVersion,
    dismissPending,
    reconnect,
  }
}
