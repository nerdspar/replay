type Level = 'debug' | 'info' | 'warn' | 'error'

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const threshold = order[(process.env.CARTRIDGE_LOG_LEVEL as Level) ?? 'info'] ?? 20

function emit(level: Level, scope: string, message: string, extra?: unknown) {
  if (order[level] < threshold) return
  const line = `[${level.toUpperCase()}] ${scope}: ${message}`
  const stream = level === 'error' || level === 'warn' ? console.error : console.log
  if (extra === undefined) stream(line)
  else stream(line, extra)
}

export interface Logger {
  debug(message: string, extra?: unknown): void
  info(message: string, extra?: unknown): void
  warn(message: string, extra?: unknown): void
  error(message: string, extra?: unknown): void
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, e) => emit('debug', scope, m, e),
    info: (m, e) => emit('info', scope, m, e),
    warn: (m, e) => emit('warn', scope, m, e),
    error: (m, e) => emit('error', scope, m, e),
  }
}
