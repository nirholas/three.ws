// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

import { describe, it, expect } from 'vitest'
import {
  XSpaceError,
  AuthenticationError,
  SpaceNotFoundError,
  SpaceEndedError,
  BrowserConnectionError,
  SpeakerAccessDeniedError,
  ProviderError,
  ConfigValidationError,
  SelectorBrokenError,
} from '../../src/errors'

describe('XSpaceError', () => {
  it('should set code, message, hint, and docsUrl', () => {
    const err = new XSpaceError('TEST_CODE', 'Something failed', 'Try again', 'https://docs.example.com')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(XSpaceError)
    expect(err.code).toBe('TEST_CODE')
    expect(err.message).toBe('Something failed')
    expect(err.hint).toBe('Try again')
    expect(err.docsUrl).toBe('https://docs.example.com')
    expect(err.name).toBe('XSpaceError')
  })

  it('should work without docsUrl', () => {
    const err = new XSpaceError('NO_DOCS', 'Error', 'Hint')
    expect(err.docsUrl).toBeUndefined()
  })

  it('should format toString with code, message, hint', () => {
    const err = new XSpaceError('CODE', 'Message text', 'Hint text')
    const str = err.toString()
    expect(str).toContain('[CODE]')
    expect(str).toContain('Message text')
    expect(str).toContain('Hint: Hint text')
  })

  it('should include docs URL in toString when present', () => {
    const err = new XSpaceError('CODE', 'msg', 'hint', 'https://docs.example.com')
    expect(err.toString()).toContain('Docs: https://docs.example.com')
  })

  it('should not include docs line when docsUrl is absent', () => {
    const err = new XSpaceError('CODE', 'msg', 'hint')
    expect(err.toString()).not.toContain('Docs:')
  })
})

describe('AuthenticationError', () => {
  it('should have AUTH_FAILED code and default hint', () => {
    const err = new AuthenticationError('Login failed')
    expect(err).toBeInstanceOf(XSpaceError)
    expect(err.code).toBe('AUTH_FAILED')
    expect(err.message).toBe('Login failed')
    expect(err.hint).toContain('auth.token')
    expect(err.name).toBe('AuthenticationError')
  })

  it('should accept a custom hint', () => {
    const err = new AuthenticationError('Login failed', 'Custom hint')
    expect(err.hint).toBe('Custom hint')
  })
})

describe('SpaceNotFoundError', () => {
  it('should contain the Space URL in message', () => {
    const url = 'https://x.com/i/spaces/abc123'
    const err = new SpaceNotFoundError(url)
    expect(err).toBeInstanceOf(XSpaceError)
    expect(err.code).toBe('SPACE_NOT_FOUND')
    expect(err.message).toContain(url)
    expect(err.hint).toContain('Verify the Space URL')
    expect(err.name).toBe('SpaceNotFoundError')
  })
})

describe('SpaceEndedError', () => {
  it('should have SPACE_ENDED code', () => {
    const err = new SpaceEndedError()
    expect(err).toBeInstanceOf(XSpaceError)
    expect(err.code).toBe('SPACE_ENDED')
    expect(err.message).toContain('ended')
    expect(err.hint).toContain('space-ended')
    expect(err.name).toBe('SpaceEndedError')
  })
})

describe('BrowserConnectionError', () => {
  it('should include mode and detail in message (connect)', () => {
    const err = new BrowserConnectionError('connect', 'connection refused')
    expect(err).toBeInstanceOf(XSpaceError)
    expect(err.code).toBe('BROWSER_CONNECTION')
    expect(err.message).toContain('connect')
    expect(err.message).toContain('connection refused')
    expect(err.hint).toContain('remote-debugging-port=9222')
    expect(err.name).toBe('BrowserConnectionError')
  })

  it('should have managed mode hint for managed mode', () => {
    const err = new BrowserConnectionError('managed', 'Chrome crashed')
    expect(err.hint).toContain('Puppeteer')
    expect(err.hint).toContain('--no-sandbox')
  })
})

describe('SpeakerAccessDeniedError', () => {
  it('should have SPEAKER_DENIED code', () => {
    const err = new SpeakerAccessDeniedError()
    expect(err).toBeInstanceOf(XSpaceError)
    expect(err.code).toBe('SPEAKER_DENIED')
    expect(err.hint).toContain('host')
    expect(err.name).toBe('SpeakerAccessDeniedError')
  })
})

describe('ProviderError', () => {
  it('should include provider and operation in message', () => {
    const err = new ProviderError('OpenAI', 'streamResponse', 'rate limit exceeded')
    expect(err).toBeInstanceOf(XSpaceError)
    expect(err.code).toBe('PROVIDER_ERROR')
    expect(err.message).toContain('OpenAI')
    expect(err.message).toContain('streamResponse')
    expect(err.message).toContain('rate limit exceeded')
    expect(err.hint).toContain('OpenAI')
    expect(err.hint).toContain('API key')
    expect(err.name).toBe('ProviderError')
  })
})

describe('ConfigValidationError', () => {
  it('should include all error messages', () => {
    const errors = ['auth.token: required', 'ai.provider: invalid']
    const err = new ConfigValidationError(errors)
    expect(err).toBeInstanceOf(XSpaceError)
    expect(err.code).toBe('CONFIG_INVALID')
    expect(err.errors).toEqual(errors)
    expect(err.message).toContain('auth.token: required')
    expect(err.message).toContain('ai.provider: invalid')
    expect(err.name).toBe('ConfigValidationError')
  })

  it('should format errors as bullet points', () => {
    const errors = ['error1', 'error2']
    const err = new ConfigValidationError(errors)
    expect(err.message).toContain('  - error1')
    expect(err.message).toContain('  - error2')
  })

  it('should handle single error', () => {
    const err = new ConfigValidationError(['single issue'])
    expect(err.errors).toHaveLength(1)
    expect(err.message).toContain('single issue')
  })

  it('should include hint about .env file', () => {
    const err = new ConfigValidationError(['test'])
    expect(err.hint).toContain('.env')
  })
})

describe('SelectorBrokenError', () => {
  it('should include selector name and tried strategies', () => {
    const err = new SelectorBrokenError('join-button', ['css', 'text', 'aria'])
    expect(err).toBeInstanceOf(XSpaceError)
    expect(err.code).toBe('SELECTOR_BROKEN')
    expect(err.message).toContain('join-button')
    expect(err.hint).toContain('css, text, aria')
    expect(err.hint).toContain('selectors.ts')
    expect(err.name).toBe('SelectorBrokenError')
  })
})

describe('Error inheritance chain', () => {
  it('all error classes extend XSpaceError', () => {
    const errors = [
      new AuthenticationError('test'),
      new SpaceNotFoundError('url'),
      new SpaceEndedError(),
      new BrowserConnectionError('managed', 'detail'),
      new SpeakerAccessDeniedError(),
      new ProviderError('prov', 'op', 'detail'),
      new ConfigValidationError(['err']),
      new SelectorBrokenError('sel', ['css']),
    ]

    for (const err of errors) {
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(XSpaceError)
      expect(typeof err.code).toBe('string')
      expect(typeof err.hint).toBe('string')
      expect(typeof err.message).toBe('string')
    }
  })
})


