import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from '../config.js'
import { createContext, type AppContext } from '../context.js'

export interface TestContext {
  ctx: AppContext
  cleanup: () => void
}

/** A real context on a throwaway on-disk database — no Home Assistant required. */
export function testContext(env: Record<string, string> = {}): TestContext {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cartridge-test-'))
  const config = loadConfig({
    CARTRIDGE_DB_PATH: path.join(dir, 'cartridge.db'),
    CARTRIDGE_WEB_ROOT: path.join(dir, 'web'),
    ...env,
  } as NodeJS.ProcessEnv)

  fs.mkdirSync(config.webRoot, { recursive: true })
  fs.writeFileSync(
    path.join(config.webRoot, 'index.html'),
    '<!doctype html><html><head><!--BASE--></head><body><div id="root"></div></body></html>',
  )

  const ctx = createContext(config)
  return {
    ctx,
    cleanup: () => {
      ctx.store.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}
