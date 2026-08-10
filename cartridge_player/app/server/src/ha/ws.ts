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

  private readonly inflight = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >()

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

  /**
   * Sends a command and waits for its result. Used for things the REST API
   * cannot answer — notably the entity registry, which is the only place that
   * says which integration an entity came from.
   *
   * Rejects rather than queues when the socket is down: callers treat this as
   * optional enrichment, and a stale answer later is worse than none now.
   */
  async command<T>(payload: Record<string, unknown>, timeoutMs = 5000): Promise<T> {
    const socket = this.socket
    if (!socket || this.state !== 'connected') {
      throw new Error('not connected to Home Assistant')
    }

    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = this.setTimeoutImpl(() => {
        this.inflight.delete(id)
        reject(new Error(`command ${String(payload.type)} timed out`))
      }, timeoutMs)

      this.inflight.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      })
      socket.send(JSON.stringify({ id, ...payload }))
    })
  }

  private settleInflight(message: Record<string, unknown>): void {
    const entry = this.inflight.get(message.id as number)
    if (!entry) return
    this.inflight.delete(message.id as number)
    this.clearTimeoutImpl(entry.timer)

    if (message.success === false) {
      const error = message.error as { message?: string } | undefined
      entry.reject(new Error(error?.message ?? 'command failed'))
      return
    }
    entry.resolve(message.result)
  }

  /** A dropped connection can never deliver its replies. */
  private failInflight(reason: string): void {
    for (const [id, entry] of this.inflight) {
      this.inflight.delete(id)
      this.clearTimeoutImpl(entry.timer)
      entry.reject(new Error(reason))
    }
  }

  stop(): void {
    this.stopped = true
    this.failInflight('stopped')
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
      this.failInflight('connection to Home Assistant closed')
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

      case 'result':
        // Subscription acknowledgements land here too; those ids are not
        // in flight, so they fall through harmlessly.
        this.settleInflight(message)
        return

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
