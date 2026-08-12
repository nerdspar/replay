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
// Playback the fake reports for any single-entity lookup.
export let readerOnline = true
export function setReader(on) { readerOnline = on; console.log(`[ha] reader ${on ? 'online' : 'offline'}`) }

export let playerState = 'idle'
export let playerAttrs = {}
export function setPlayer(state, attrs = {}) {
  playerState = state
  playerAttrs = attrs
  console.log(`[ha] player -> ${state}`)
}

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
  { entity_id: 'remote.living_room_tv', platform: 'androidtv_remote', config_entry_id: 'atv-1' },
  { entity_id: 'remote.bedroom_tv', platform: 'androidtv_remote', config_entry_id: 'atv-1' },
  { entity_id: 'media_player.living_room', platform: 'androidtv_remote', config_entry_id: 'atv-1' },
  {
    entity_id: 'media_player.living_room_2',
    platform: 'music_assistant',
    config_entry_id: 'mass-1',
  },
  {
    entity_id: 'media_player.kitchen_speaker',
    platform: 'music_assistant',
    config_entry_id: 'mass-1',
  },
]

/**
 * Canned music_assistant.search results, shaped like the real thing: grouped
 * under plural keys, artists as a list of objects, cover art sometimes only in
 * the metadata block. Filtered by substring so searching behaves plausibly.
 */
const MUSIC_LIBRARY = {
  albums: [
    {
      uri: 'library://album/12',
      name: 'Rumours',
      media_type: 'album',
      year: 1977,
      artists: [{ name: 'Fleetwood Mac' }],
      image: 'https://placehold.co/600x600/1f6feb/ffffff/png?text=Rumours',
    },
    {
      uri: 'library://album/13',
      name: 'Kind of Blue',
      media_type: 'album',
      year: 1959,
      artists: [{ name: 'Miles Davis' }],
      image: 'https://placehold.co/600x600/0d1117/ffffff/png?text=Kind+of+Blue',
    },
  ],
  artists: [
    {
      uri: 'library://artist/3',
      name: 'Fleetwood Mac',
      media_type: 'artist',
      metadata: { images: [{ path: 'https://placehold.co/600x600/8957e5/fff/png?text=FM', type: 'thumb' }] },
    },
  ],
  playlists: [
    {
      uri: 'library://playlist/7',
      name: 'Sunday Morning',
      media_type: 'playlist',
      image: 'https://placehold.co/600x600/238636/ffffff/png?text=Sunday',
    },
  ],
  tracks: [],
  radio: [
    {
      uri: 'radiobrowser://station/99',
      name: 'BBC Radio 6 Music',
      media_type: 'radio',
      image: 'https://placehold.co/600x600/da3633/ffffff/png?text=6+Music',
    },
  ],
  podcasts: [],
  audiobooks: [],
}

function musicSearch(data) {
  const needle = String(data.name ?? '').toLowerCase()
  const wanted = new Set(
    Array.isArray(data.media_type) ? data.media_type : data.media_type ? [data.media_type] : [],
  )
  const keyFor = {
    album: 'albums',
    artist: 'artists',
    playlist: 'playlists',
    track: 'tracks',
    radio: 'radio',
    podcast: 'podcasts',
    audiobook: 'audiobooks',
  }
  const allowed = new Set(
    wanted.size === 0 ? Object.values(keyFor) : [...wanted].map((t) => keyFor[t]),
  )

  const out = {}
  for (const [key, items] of Object.entries(MUSIC_LIBRARY)) {
    out[key] = allowed.has(key)
      ? items.filter((i) => i.name.toLowerCase().includes(needle)).slice(0, data.limit ?? 5)
      : []
  }
  return out
}

const supervisor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const json = (body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  if (url.pathname === '/addons/self/info') {
    return json({ data: { slug: 'a0d7b954_cartridge_player', version: '0.1.0' } })
  }
  // One entity, so the add-on can follow what is actually playing. Drive it
  // with:  curl 'http://127.0.0.1:9125/player?state=playing'
  const one = url.pathname.match(/^\/core\/api\/states\/(.+)$/)
  if (one) {
    const found = STATES.find((s) => s.entity_id === one[1])
    return found
      ? json({ ...found, state: playerState, attributes: { ...found.attributes, ...playerAttrs } })
      : json({ error: 'not found' }, 404)
  }

  if (url.pathname === '/core/api/states') return json(STATES)

  // What an ESPHome device's user-defined actions look like to Home Assistant.
  if (url.pathname === '/core/api/services') {
    return json([
      {
        domain: 'esphome',
        services: {
          ...(readerOnline ? { cartridge_reader_set_status: { name: 'set_status' } } : {}),
          cartridge_reader_set_palette: { name: 'set_palette' },
          cartridge_reader_set_status_color: { name: 'set_status_color' },
        },
      },
      { domain: 'remote', services: { turn_on: {}, turn_off: {}, send_command: {} } },
    ])
  }

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

      // Services that answer back only do so when explicitly asked, exactly
      // like the real API.
      if (
        url.searchParams.get('return_response') === 'true' &&
        service[1] === 'music_assistant' &&
        service[2] === 'search'
      ) {
        return json({
          changed_states: [],
          service_response: musicSearch(JSON.parse(body || '{}')),
        })
      }
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
    } else if (url.pathname === '/reader') {
      setReader(url.searchParams.get('online') !== 'false')
    } else if (url.pathname === '/player') {
      setPlayer(url.searchParams.get('state') ?? 'idle', {
        media_title: url.searchParams.get('title') ?? undefined,
        media_content_id: url.searchParams.get('id') ?? undefined,
      })
    } else if (url.pathname === '/reset') serviceCalls.length = 0
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
  .listen(9125, () => console.log('[ha] control on 9125'))
