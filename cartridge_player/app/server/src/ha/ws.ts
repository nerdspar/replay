import WebSocket from 'ws'
import { createLogger } from '../log.js'
import type { ConnectionState } from '../core/events.js'

const log = createLogger('ha-ws')

export interface SocketLike {
  send(data: string): void
  close(): void
  on(event: 'open', cb: () => void): void
  on(event: 'message', cb: (data: unknown) => void): void
  on(event: 'close', cb: () => void): void
  on(event: 'error', cb: (error: Error) => void): void
}

export type SocketFactory = (url: string) => SocketLike

export interface HaEvent {
  event_type: string
  data: Record<string, unknown>
}

export interface HomeAssistantWsOptions {
  url: string
  token: string | null
  /** Event types to (re)subscribe to on every successful connection. */
  eventTypes: string[]
  onEvent: (event: HaEvent) => void
  onStateChange?: (state: ConnectionState, detail?: string) => void
  socketFactory?: SocketFactory
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
  /** Backoff schedule in ms; the last value repeats. */
  backoffMs?: number[]
}

const DEFAULT_BACKOFF = [1000, 2000, 5000, 10_000, 30_000]

const defaultSocketFactory: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike

/**
 * Subscribes to Home Assistant events over the WebSocket API so the user never
 * has to create an automation — the add-on is the entire integration surface
 * (§3.2). Home Assistant restarts; this resubscribes without intervention.
 */
export class HomeAssistantWs {
  private socket: SocketLike | null = null
  private nextId = 1
  private attempt = 0
  private stopped = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private state: ConnectionState = 'disconnected'

  private readonly backoff: number[]
  private readonly setTimeoutImpl: typeof setTimeout
  private readonly clearTimeoutImpl: typeof clearTimeout
  private readonly socketFactory: SocketFactory

  constructor(private readonly options: HomeAssistantWsOptions) {
    this.backoff = options.backoffMs ?? DEFAULT_BACKOFF
    this.setTimeoutImpl = options.setTimeoutImpl ?? setTimeout
    this.clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout
    this.socketFactory = options.socketFactory ?? defaultSocketFactory
  }

  get connectionState(): ConnectionState {
    return this.state
  }

  start(): void {
    this.stopped = false
    this.open()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer !== null) {
      this.clearTimeoutImpl(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.socket?.close()
    this.socket = null
    this.setState('disconnected')
  }

  private setState(state: ConnectionState, detail?: string): void {
    if (this.state === state) return
    this.state = state
    this.options.onStateChange?.(state, detail)
  }

  private open(): void {
    if (!this.options.token) {
      log.error('no SUPERVISOR_TOKEN — cannot subscribe to Home Assistant events')
      this.setState('disconnected', 'missing SUPERVISOR_TOKEN')
      return
    }

    this.setState('connecting')
    let socket: SocketLike
    try {
      socket = this.socketFactory(this.options.url)
    } catch (error) {
      this.scheduleReconnect((error as Error).message)
      return
    }
    this.socket = socket

    socket.on('open', () => {
      log.debug('socket open, waiting for auth challenge')
    })

    socket.on('message', (raw) => {
      let message: Record<string, unknown>
      try {
        message = JSON.parse(String(raw)) as Record<string, unknown>
      } catch {
        return
      }
      this.handleMessage(socket, message)
    })

    socket.on('error', (error) => {
      log.warn(`socket error: ${error.message}`)
    })

    socket.on('close', () => {
      if (this.socket === socket) this.socket = null
      this.scheduleReconnect('connection closed')
    })
  }

  private handleMessage(socket: SocketLike, message: Record<string, unknown>): void {
    switch (message.type) {
      case 'auth_required':
        socket.send(
          JSON.stringify({ type: 'auth', access_token: this.options.token }),
        )
        return

      case 'auth_ok':
        this.attempt = 0
        this.setState('connected')
        // Subscriptions are per-connection: always re-issue them here.
        for (const eventType of this.options.eventTypes) {
          socket.send(
            JSON.stringify({
              id: this.nextId++,
              type: 'subscribe_events',
              event_type: eventType,
            }),
          )
        }
        log.info(`subscribed to ${this.options.eventTypes.join(', ')}`)
        return

      case 'auth_invalid':
        log.error('Home Assistant rejected the supervisor token')
        this.setState('disconnected', 'auth_invalid')
        socket.close()
        return

      case 'event': {
        const event = message.event as HaEvent | undefined
        if (event?.event_type) this.options.onEvent(event)
        return
      }

      default:
        return
    }
  }

  private scheduleReconnect(detail: string): void {
    if (this.stopped || this.reconnectTimer !== null) return
    this.setState('disconnected', detail)

    const index = Math.min(this.attempt, this.backoff.length - 1)
    const delay = this.backoff[index] ?? 30_000
    this.attempt += 1

    log.warn(`disconnected (${detail}); retrying in ${delay}ms`)
    this.reconnectTimer = this.setTimeoutImpl(() => {
      this.reconnectTimer = null
      this.open()
    }, delay)
  }
}
