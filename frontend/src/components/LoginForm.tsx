import { FormEvent, useState } from 'react'
import { ArrowRight, Eye, EyeOff, LockKeyhole, UserRound } from 'lucide-react'
import { motion } from 'motion/react'
import { ApiError, login } from '../lib/api'
import { saveSession } from '../lib/auth-storage'
import type { Session } from '../types'
import { useToast } from './ui/ToastProvider'

export function LoginForm({ onAuthenticated, notice }: { onAuthenticated: (session: Session) => void; notice?: string }) {
  const [username, setUsername] = useState(import.meta.env.DEV ? 'admin' : '')
  const [password, setPassword] = useState(import.meta.env.DEV ? 'ChangeMe123!' : '')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setFieldErrors({})

    try {
      const session = await login({
        username: username.trim(),
        password,
        remember,
      })
      saveSession(session, remember)
      toast({ message: 'Signed in successfully', variant: 'success' })
      onAuthenticated(session)
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors)
      toast({ message: caught instanceof Error ? caught.message : 'Unable to sign in', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      className="login-card"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="login-card__header">
        <h1>Welcome back <span aria-hidden="true">☀</span></h1>
      </div>

      {notice && <div className="login-session-notice">{notice}</div>}
      <form onSubmit={handleSubmit} className="login-form">
        <label className="field">
          <span>Username</span>
          <div className="field__control">
            <UserRound size={18} />
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Enter your username"
              required
              minLength={3}
              maxLength={50}
            />
          </div>
          {fieldErrors.username?.map((message) => <small className="field-error" key={message}>{message}</small>)}
        </label>

        <label className="field">
          <span>Password</span>
          <div className="field__control">
            <LockKeyhole size={18} />
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
              minLength={8}
            />
            <button
              type="button"
              className="field__action"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {fieldErrors.password?.map((message) => <small className="field-error" key={message}>{message}</small>)}
        </label>

        <div className="login-form__options">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>Remember me</span>
          </label>
        </div>

        <motion.button
          className="primary-button"
          type="submit"
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.99 }}
          disabled={loading}
        >
          <span>{loading ? 'Signing in…' : 'Sign in'}</span>
          <ArrowRight size={18} />
        </motion.button>
      </form>
    </motion.div>
  )
}
