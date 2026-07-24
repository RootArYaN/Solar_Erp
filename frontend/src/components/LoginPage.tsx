import type { Session } from '../types'
import { BrandMark } from './BrandMark'
import { LoginForm } from './LoginForm'
import { SolarScene } from './SolarScene'

export function LoginPage({ onAuthenticated, notice }: { onAuthenticated: (session: Session) => void; notice?: string }) {
  return (
    <main className="auth-page">
      <div className="auth-shell">
        <section className="auth-hero"><div className="auth-hero__content"><BrandMark /></div><SolarScene /></section>
        <section className="auth-panel"><div className="auth-panel__mobile-brand"><BrandMark compact /></div><LoginForm notice={notice} onAuthenticated={onAuthenticated} /></section>
      </div>
    </main>
  )
}
