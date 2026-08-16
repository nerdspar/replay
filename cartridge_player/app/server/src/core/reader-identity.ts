/**
 * Reading a scan event's two fields.
 *
 * Separate from the entrypoint because that file starts the add-on the moment
 * it is imported — parsing has no business being reachable only by booting the
 * whole process.
 */

export function readUid(data: Record<string, unknown>): string | null {
  const uid = data.uid
  return typeof uid === 'string' && uid.trim() !== '' ? uid.trim() : null
}

/**
 * Which reader a scan came from, or null on firmware that predates it.
 *
 * Every reader in a house fires the same event type, so this string is the only
 * thing that can tell one from another. Null is not an error: a reader flashed
 * before this existed still works, and is treated as the only reader there is.
 *
 * The value is the ESPHome `device_name`, which is also what Home Assistant
 * derives that reader's light actions from — so one string ties a tap to the
 * light it should drive.
 */
export function readDevice(data: Record<string, unknown>): string | null {
  const device = data.device
  return typeof device === 'string' && device.trim() !== '' ? device.trim() : null
}
