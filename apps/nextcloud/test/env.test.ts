import { describe, expect, it } from 'vitest'
import { readEnv } from '../src/types.js'

describe('readEnv', () => {
  it('refuses to start without APP_SECRET', () => {
    expect(() => readEnv({})).toThrow(/APP_SECRET/)
    expect(() => readEnv({ APP_SECRET: '' })).toThrow(/APP_SECRET/)
  })

  it('reads the AppAPI deploy env', () => {
    expect(
      readEnv({
        APP_ID: 'ohhi',
        APP_SECRET: 's3cret',
        APP_PORT: '23001',
        APP_HOST: '0.0.0.0',
        APP_VERSION: '0.1.0',
        AA_VERSION: '5.0.2',
        NEXTCLOUD_URL: 'http://nextcloud.local/',
        APP_PERSISTENT_STORAGE: '/data',
        OHHI_PUBLIC_ORIGINS: 'https://cloud.example.org, junk',
        OHHI_LOG_LEVEL: 'debug',
      })
    ).toEqual({
      appId: 'ohhi',
      appSecret: 's3cret',
      appPort: 23001,
      appHost: '0.0.0.0',
      appVersion: '0.1.0',
      aaVersion: '5.0.2',
      nextcloudUrl: 'http://nextcloud.local',
      publicOrigins: ['https://cloud.example.org'],
      persistentStorage: '/data',
      logLevel: 'debug',
    })
  })

  it('defaults what AppAPI may leave out', () => {
    const env = readEnv({ APP_SECRET: 'x' })
    expect(env.appId).toBe('ohhi')
    expect(env.appPort).toBe(23000)
    expect(env.persistentStorage).toBe('/nc_app_ohhi_data')
    expect(env.publicOrigins).toEqual([])
    expect(env.logLevel).toBe('info')
  })

  it('rejects a port that is not one', () => {
    expect(() => readEnv({ APP_SECRET: 'x', APP_PORT: 'eighty' })).toThrow(/APP_PORT/)
  })
})
