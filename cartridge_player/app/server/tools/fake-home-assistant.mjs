// A stand-in for Supervisor + Home Assistant, so the add-on can be driven end to
// end without a real HAOS instance, a real TV, or a real NFC reader.
//
// Crucially it proxies the add-on the way ingress does — under a rotating
// session path, with X-Ingress-Path set — because that is the single most
// likely thing to break (§3.3) and it does not exist on a plain dev port.
//
//   :9123  Supervisor REST (/core/api/…, /addons/self/info) + event WebSocket
//   :9124  Ingress proxy   → http://127.0.0.1:8099
//   :9125  Test control    → /insert /remove /calls /reset
//
// Usage, from cartridge_player/app/server:
//
//   npm run dev:fake-ha            # terminal 1
//   npm run dev:against-fake-ha    # terminal 2
//
// then open http://127.0.0.1:9124/api/hassio_ingress/AbC123SessionToken/
//
// Simulate a cartridge tap:
//   curl "http://127.0.0.1:9125/insert?uid=04-A3-B8-8B-32-02-89"
//   curl "http://127.0.0.1:9125/remove?uid=04-A3-B8-8B-32-02-89"
//
// See exactly what reached the "TV":
//   curl -s http://127.0.0.1:9125/calls | python3 -m json.tool
import http from 'node:http'
import { WebSocketServer } from 'ws'

const ADDON = process.env.ADDON_ORIGIN ?? 'http://127.0.0.1:8099'
const TOKEN = 'AbC123SessionToken'

export const serviceCalls = []
const sockets = new Set()

// Deliberately reproduces the duplicate-name problem: a household running both
// a native integration and Music Assistant ends up with two media players
// carrying the SAME friendly name, which a name-only dropdown cannot tell apart.
const STATES = [
  { entity_id: 'remote.living_room_tv', state: 'on', attributes: { friendly_name: 'Living Room TV' } },
  { entity_id: 'remote.bedroom_tv', state: 'off', attributes: { friendly_name: 'Bedroom TV' } },
  {
    entity_id: 'media_player.living_room',
    state: 'idle',
    attributes: { friendly_name: 'Living Room' },
  },
  {
    entity_id: 'media_player.living_room_2',
    state: 'idle',
    attributes: { friendly_name: 'Living Room' },
  },
  {
    entity_id: 'media_player.kitchen_speaker',
    state: 'playing',
    attributes: { friendly_name: 'Kitchen Speaker' },
  },
]

/** What `config/entity_registry/list` returns — the platform is the giveaway. */
const ENTITY_REGISTRY = [
  { entity_id: 'remote.living_room_tv', platform: 'androidtv_remote' },
  { entity_id: 'remote.bedroom_tv', platform: 'androidtv_remote' },
  { entity_id: 'media_player.living_room', platform: 'androidtv_remote' },
  { entity_id: 'media_player.living_room_2', platform: 'music_assistant' },
  { entity_id: 'media_player.kitchen_speaker', platform: 'music_assistant' },
]

const supervisor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const json = (body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  if (url.pathname === '/addons/self/info') {
    return json({ data: { slug: 'a0d7b954_cartridge_player', version: '0.1.0' } })
  }
  if (url.pathname === '/core/api/states') return json(STATES)

  const service = url.pathname.match(/^\/core\/api\/services\/([^/]+)\/([^/]+)$/)
  if (service && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      serviceCalls.push({
        domain: service[1],
        service: service[2],
        data: JSON.parse(body || '{}'),
        at: Date.now(),
      })
      console.log(`[ha] ${service[1]}.${service[2]}`, body)
      json([])
    })
    return
  }
  json({ error: 'not found' }, 404)
})

const wss = new WebSocketServer({ server: supervisor, path: '/core/websocket' })
wss.on('connection', (socket) => {
  sockets.add(socket)
  socket.send(JSON.stringify({ type: 'auth_required', ha_version: '2026.8.0' }))
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw))
    if (message.type === 'auth') {
      console.log('[ha] websocket authenticated')
      socket.send(JSON.stringify({ type: 'auth_ok', ha_version: '2026.8.0' }))
    } else if (message.type === 'subscribe_events') {
      console.log(`[ha] subscribed: ${message.event_type}`)
      socket.send(JSON.stringify({ id: message.id, type: 'result', success: true, result: null }))
    } else if (message.type === 'config/entity_registry/list') {
      console.log('[ha] entity registry requested')
      socket.send(
        JSON.stringify({ id: message.id, type: 'result', success: true, result: ENTITY_REGISTRY }),
      )
    } else if (message.id) {
      socket.send(
        JSON.stringify({
          id: message.id,
          type: 'result',
          success: false,
          error: { code: 'unknown_command', message: message.type },
        }),
      )
    }
  })
  socket.on('close', () => sockets.delete(socket))
})

export function fireTag(eventType, uid) {
  const frame = JSON.stringify({
    id: 1,
    type: 'event',
    event: { event_type: eventType, data: { uid }, origin: 'LOCAL' },
  })
  for (const socket of sockets) socket.send(frame)
  console.log(`[ha] emitted ${eventType} ${uid} to ${sockets.size} client(s)`)
}

// Ingress proxy: mounts the add-on under a rotating session path and sets
// X-Ingress-Path, exactly as Home Assistant does.
const ingress = http.createServer(async (req, res) => {
  const prefix = `/api/hassio_ingress/${TOKEN}`
  if (!req.url.startsWith(prefix)) {
    res.writeHead(404).end('not ingress')
    return
  }
  const rest = req.url.slice(prefix.length) || '/'

  let upstream
  try {
    upstream = await fetch(`${ADDON}${rest}`, {
      method: req.method,
      headers: {
        ...Object.fromEntries(Object.entries(req.headers).filter(([k]) => k !== 'host')),
        'x-ingress-path': prefix,
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
      duplex: 'half',
    })
  } catch (error) {
    // The add-on is down or restarting. Say so and keep serving — an unhandled
    // rejection here used to take the whole simulator with it, which meant
    // starting the two processes in the wrong order killed this one.
    res.writeHead(502, { 'content-type': 'text/plain' })
    res.end(
      `Cannot reach the add-on at ${ADDON}.\n\n` +
        `Start it with:  npm run dev:against-fake-ha\n\n${error.cause?.code ?? error.message}\n`,
    )
    return
  }

  try {
    res.writeHead(upstream.status, Object.fromEntries(upstream.headers))
    if (!upstream.body) return res.end()
    for await (const chunk of upstream.body) res.write(chunk)
    res.end()
  } catch {
    // Client hung up mid-stream (common with SSE); nothing to do.
    res.destroy()
  }
})

// Last line of defence: never let a stray rejection end the simulator.
process.on('unhandledRejection', (reason) => {
  console.error('[ha] unhandled rejection (ignored):', reason?.message ?? reason)
})

supervisor.listen(9123, () => console.log('[ha] supervisor on 9123'))
ingress.listen(9124, () =>
  console.log(`[ha] ingress on http://127.0.0.1:9124/api/hassio_ingress/${TOKEN}/`),
)

// Simple control channel so the test driver can trigger tag events.
http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/insert') fireTag('esphome.nfc_card_inserted', url.searchParams.get('uid'))
    else if (url.pathname === '/remove')
      fireTag('esphome.nfc_card_removed', url.searchParams.get('uid'))
    else if (url.pathname === '/calls') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(serviceCalls))
    } else if (url.pathname === '/reset') serviceCalls.length = 0
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
  .listen(9125, () => console.log('[ha] control on 9125'))
