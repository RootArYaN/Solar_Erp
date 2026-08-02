const TECHNICAL_ERROR_PATTERN = /(?:traceback|stack trace|sqlalchemy|psycopg|postgres|exception|typeerror|syntaxerror|\/api\/|https?:\/\/|\{["']|\[["']|status(?: code)?\s*\d{3})/i
const NETWORK_ERROR_PATTERN = /(?:failed to fetch|networkerror|network request failed|load failed|connection refused)/i

function cleanMessage(message: string): string {
  return message
    .replace(/^value error,\s*/i, '')
    .replace(/^error:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function withPeriod(message: string): string {
  return /[.!?]$/.test(message) ? message : `${message}.`
}

export function simpleToastError(message: string): string {
  const cleaned = cleanMessage(message)
  if (NETWORK_ERROR_PATTERN.test(cleaned)) {
    return 'Could not connect to the server. Check your connection and try again.'
  }
  if (
    !cleaned
    || cleaned.length > 140
    || cleaned.includes('\n')
    || TECHNICAL_ERROR_PATTERN.test(cleaned)
  ) {
    return 'Something went wrong. Please try again.'
  }
  return withPeriod(cleaned)
}

export function apiErrorMessage(input: {
  status: number
  code: string
  message: string
  hasFieldErrors: boolean
}): string {
  const { status, code, message, hasFieldErrors } = input
  const normalizedCode = code.toLowerCase()
  const normalizedMessage = cleanMessage(message).toLowerCase()

  if (status === 401) {
    if (normalizedMessage.includes('username') || normalizedMessage.includes('password')) {
      return 'Username or password is incorrect.'
    }
    return 'Your session ended. Please sign in again.'
  }
  if (status === 403) return 'You do not have permission to do that.'
  if (status === 404) return 'The requested item could not be found.'
  if (status === 409) return 'This item changed or already exists. Refresh and try again.'
  if (status === 413) return 'The selected file is too large.'
  if (status === 422 || hasFieldErrors || normalizedCode === 'validation_error') {
    return 'Please check the entered information and try again.'
  }
  if (status === 429) return 'Too many attempts. Wait a moment and try again.'
  if (status >= 500) return 'The server is temporarily unavailable. Please try again.'

  return simpleToastError(message)
}
