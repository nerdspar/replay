export interface DirectModeDecision {
  start: boolean
  reason: 'disabled' | 'no_pin' | 'ok'
  message: string
}

/**
 * §3.4 — LAN-direct mode bypasses Home Assistant auth entirely, so it refuses to
 * start without an app-level PIN. The ingress listener is unaffected: that is
 * where the PIN gets set, and locking the user out of it would be a trap.
 */
export function resolveDirectMode(
  directPort: number,
  pinHash: string | null,
): DirectModeDecision {
  if (directPort === 0) {
    return { start: false, reason: 'disabled', message: 'LAN-direct mode is off.' }
  }
  if (pinHash === null) {
    return {
      start: false,
      reason: 'no_pin',
      message:
        `direct_port ${directPort} is set but no PIN is configured; ` +
        'LAN-direct mode stays off. Set a PIN in Settings.',
    }
  }
  return {
    start: true,
    reason: 'ok',
    message: `LAN-direct listening on ${directPort} (PIN required)`,
  }
}
