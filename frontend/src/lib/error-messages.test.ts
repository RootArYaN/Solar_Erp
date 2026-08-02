import { describe, expect, it } from 'vitest'
import { apiErrorMessage, simpleToastError } from './error-messages'

describe('user-facing error messages', () => {
  it('uses short guidance for common API failures', () => {
    expect(apiErrorMessage({ status: 403, code: 'http_403', message: 'Internal permission rule failed', hasFieldErrors: false }))
      .toBe('You do not have permission to do that.')
    expect(apiErrorMessage({ status: 422, code: 'validation_error', message: 'body.items.0: value error', hasFieldErrors: true }))
      .toBe('Please check the entered information and try again.')
    expect(apiErrorMessage({ status: 500, code: 'internal_error', message: 'SQLAlchemy stack trace', hasFieldErrors: false }))
      .toBe('The server is temporarily unavailable. Please try again.')
  })

  it('keeps useful business messages and hides technical text', () => {
    expect(simpleToastError('Generate the quotation before making a decision'))
      .toBe('Generate the quotation before making a decision.')
    expect(simpleToastError('psycopg connection refused at /api/v1/projects'))
      .toBe('Could not connect to the server. Check your connection and try again.')
  })

  it('explains login and connection errors clearly', () => {
    expect(apiErrorMessage({ status: 401, code: 'http_401', message: 'Invalid username or password', hasFieldErrors: false }))
      .toBe('Username or password is incorrect.')
    expect(simpleToastError('TypeError: Failed to fetch'))
      .toBe('Could not connect to the server. Check your connection and try again.')
  })
})
