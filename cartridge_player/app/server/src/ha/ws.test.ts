import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeAssistantWs, type SocketLike } from './ws.js'
import type { ConnectionState } from '../core/events.js'

class FakeSocket implements SocketLike {
  readonly sent: Record<string, unknown>[] = []
  closed = false
  private handlers: Record<string, ((arg?: unknown) => void)[]> = {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }

  close(): void {
    this.closed = true
    this.fire('close')
  }

  on(event: string, cb: (arg?: never) => void): void {
    ;(this.handlers[event] ??= []).push(cb as (arg?: unknown) => void)
  }

  fire(event: string, arg?: unknown): void {
    for (const cb of this.handlers[event] ?? []) cb(arg)
  }

  /** Drives the real handshake: challenge, then success. */
  handshake(): void {
    this.fire('open')
    this.fire('message', JSON.stringify({ type: 'auth_required' }))
    this.fire('message', JSON.stringify({ type: 'auth_ok' }))
  }

  emitEvent(eventType: string, data: Record<string, unknown>): void {
    this.fire('message', JSON.stringify({ type: 'event', event: { event_type: eventType, data } }))
  }

  get subscriptions(): string[] {
    return this.sent
      .filter((m) => m.type === 'subscribe_events')
      .map((m) => String(m.event_type))
  }
}

function harness() {
  const sockets: FakeSocket[] = []
  const events: { event_type: string; data: Record<string, unknown> }[] = []
  const states: ConnectionState[] = []

  const client = new HomeAssistantWs({
    url: 'ws://supervisor/core/websocket',
    token: 'test-token',
    eventTypes: ['esphome.nfc_card_inserted', 'esphome.nfc_card_removed'],
    onEvent: (e) => events.push(e),
    onStateChange: (state) => states.push(state),
    socketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    backoffMs: [1000, 2000, 5000],
  })

  return { client, sockets, events, states }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Home Assistant WebSocket (§3.2)', () => {
  it('authenticates with the supervisor token and subscribes to both events', () => {
    const { client, sockets } = harness()
    client.start()
    sockets[0]!.handshake()

    expect(sockets[0]!.sent[0]).toEqual({ type: 'auth', access_token: 'test-token' })
    expect(sockets[0]!.subscriptions).toEqual([
      'esphome.nfc_card_inserted',
      'esphome.nfc_card_removed',
    ])
    expect(client.connectionState).toBe('connected')
  })

  it('delivers event payloads to the handler', () => {
    const { client, sockets, events } = harness()
    client.start()
    sockets[0]!.handshake()
    sockets[0]!.emitEvent('esphome.nfc_card_inserted', { uid: '04-A3-B8' })

    expect(events).toEqual([
      { event_type: 'esphome.nfc_card_inserted', data: { uid: '04-A3-B8' } },
    ])
  })

  /** Home Assistant restarts; the add-on must resubscribe without intervention. */
  it('reconnects after a drop and restores every subscription', () => {
    const { client, sockets, events } = harness()
    client.start()
    sockets[0]!.handshake()

    sockets[0]!.fire('close')
    expect(client.connectionState).toBe('disconnected')
    expect(sockets).toHaveLength(1)

    vi.advanceTimersByTime(1000)
    expect(sockets).toHaveLength(2)

    sockets[1]!.handshake()
    expect(sockets[1]!.subscriptions).toEqual([
      'esphome.nfc_card_inserted',
      'esphome.nfc_card_removed',
    ])
    expect(client.connectionState).toBe('connected')

    // And it is genuinely live again, not just connected.
    sockets[1]!.emitEvent('esphome.nfc_card_removed', { uid: '04-A3-B8' })
    expect(events).toHaveLength(1)
  })

  it('backs off progressively while Home Assistant stays down', () => {
    const { client, sockets } = harness()
    client.start()

    sockets[0]!.fire('close')
    vi.advanceTimersByTime(999)
    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(2)

    sockets[1]!.fire('close')
    vi.advanceTimersByTime(1999)
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(3)

    sockets[2]!.fire('close')
    vi.advanceTimersByTime(5000)
    expect(sockets).toHaveLength(4)
  })

  it('resets the backoff once a connection succeeds', () => {
    const { client, sockets } = harness()
    client.start()

    sockets[0]!.fire('close')
    vi.advanceTimersByTime(1000)
    sockets[1]!.fire('close')
    vi.advanceTimersByTime(2000)

    sockets[2]!.handshake()
    sockets[2]!.fire('close')

    // Back to the first backoff step, not still at 5s.
    vi.advanceTimersByTime(1000)
    expect(sockets).toHaveLength(4)
  })

  it('stops reconnecting once stopped', () => {
    const { client, sockets } = harness()
    client.start()
    sockets[0]!.handshake()

    client.stop()
    vi.advanceTimersByTime(60_000)

    expect(sockets).toHaveLength(1)
    expect(client.connectionState).toBe('disconnected')
  })

  it('reports a rejected token as disconnected and never claims to be subscribed', () => {
    const { client, sockets, states } = harness()
    client.start()
    sockets[0]!.fire('open')
    sockets[0]!.fire('message', JSON.stringify({ type: 'auth_invalid' }))

    expect(client.connectionState).toBe('disconnected')
    expect(states).not.toContain('connected')
    expect(sockets[0]!.subscriptions).toEqual([])
  })

  it('survives a malformed frame', () => {
    const { client, sockets, events } = harness()
    client.start()
    sockets[0]!.handshake()

    expect(() => sockets[0]!.fire('message', 'not json')).not.toThrow()
    expect(events).toEqual([])
  })
})
