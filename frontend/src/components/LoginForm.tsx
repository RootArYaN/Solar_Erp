import { FormEvent, useState } from 'react'
import { ArrowRight, Building2, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { motion } from 'motion/react'
import { login } from '../lib/api'
import { saveSession } from '../lib/auth-storage'
import type { Session } from '../types'

export function LoginForm({ onAuthenticated }: { onAuthenticated: (session: Session) => void }) {
  const [email, setEmail] = useState('admin@solarerp.dev')
  const [password, setPassword] = useState('ChangeMe123!')
  const [companyCode, setCompanyCode] = useState('SHREE')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const session = await login({
        email: email.trim(),
        password,
        company_code: companyCode.trim() || undefined,
      })
      saveSession(session, remember)
      onAuthenticated(session)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in')
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
        <div className="eyebrow">Secure company workspace</div>
        <h1>Welcome back <span aria-hidden="true">☀</span></h1>
        <p>Sign in to continue to your Solar ERP workspace.</p>
      </div>

      <form onSubmit={handleSubmit} className="login-form">
        <label className="field">
          <span>Email address</span>
          <div className="field__control">
            <Mail size={18} />
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
              required
            />
          </div>
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
        </label>

        <label className="field">
          <span>Company code</span>
          <div className="field__control">
            <Building2 size={18} />
            <input
              value={companyCode}
              onChange={(event) => setCompanyCode(event.target.value.toUpperCase())}
              placeholder="Optional for single-company users"
              maxLength={32}
            />
          </div>
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
          <button type="button" className="text-button" disabled>
            Forgot password?
          </button>
        </div>

        {error && <div className="form-error" role="alert">{error}</div>}

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

      <div className="security-note">
        <ShieldCheck size={22} />
        <div>
          <strong>Protected ERP access</strong>
          <span>Company-scoped roles and permissions are ready for expansion.</span>
        </div>
      </div>
    </motion.div>
  )
}
