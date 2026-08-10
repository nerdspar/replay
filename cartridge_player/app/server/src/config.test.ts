/**
 * Add-on options used to be read by `bashio::config` in run.sh. Those helpers
 * are not present in every base image; when they were missing the script exited
 * 1 under `set -e`, the container never listened, and the ingress panel returned
 * a bare 404 with nothing pointing at the add-on. Reading the file in-process
 * removes that dependency — and these tests keep it removed.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig, readAddonOptions } from './config.js'

const dirs: string[] = []

function optionsFile(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cartridge-options-'))
  dirs.push(dir)
  const file = path.join(dir, 'options.json')
  fs.writeFileSync(file, contents)
  return file
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('readAddonOptions', () => {
  it('reads what Supervisor wrote', () => {
    expect(readAddonOptions(optionsFile('{"direct_port": 8100}'))).toEqual({
      direct_port: 8100,
    })
  })

  it('returns nothing when the file is absent, as it is outside Home Assistant', () => {
    expect(readAddonOptions('/nonexistent/options.json')).toEqual({})
  })

  it('survives a malformed file rather than taking the container down with it', () => {
    expect(readAddonOptions(optionsFile('{not json'))).toEqual({})
    expect(readAddonOptions(optionsFile(''))).toEqual({})
    expect(readAddonOptions(optionsFile('null'))).toEqual({})
    expect(readAddonOptions(optionsFile('"a string"'))).toEqual({})
  })
})

describe('loadConfig', () => {
  const env = { CARTRIDGE_DB_PATH: '/data/cartridge.db' } as NodeJS.ProcessEnv

  it('takes direct_port from the add-on options', () => {
    expect(loadConfig(env, { direct_port: 8100 }).directPort).toBe(8100)
  })

  it('accepts a stringified port, since schemas have been known to hand one over', () => {
    expect(loadConfig(env, { direct_port: '8100' }).directPort).toBe(8100)
  })

  it('defaults to off when the option is absent or unusable', () => {
    expect(loadConfig(env, {}).directPort).toBe(0)
    expect(loadConfig(env, { direct_port: null }).directPort).toBe(0)
    expect(loadConfig(env, { direct_port: 'nonsense' }).directPort).toBe(0)
  })

  it('treats an explicit 0 as off rather than falling through to the env var', () => {
    const withEnv = { ...env, CARTRIDGE_DIRECT_PORT: '9999' } as NodeJS.ProcessEnv
    expect(loadConfig(withEnv, { direct_port: 0 }).directPort).toBe(0)
  })

  it('still honours the env var for development outside Home Assistant', () => {
    const withEnv = { ...env, CARTRIDGE_DIRECT_PORT: '8100' } as NodeJS.ProcessEnv
    expect(loadConfig(withEnv, {}).directPort).toBe(8100)
  })

  it('always serves ingress on 8099, which config.yaml declares', () => {
    expect(loadConfig(env, {}).ingressPort).toBe(8099)
  })
})
