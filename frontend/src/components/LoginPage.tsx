import type { Session } from '../types'
import { BrandMark } from './BrandMark'
import { LoginForm } from './LoginForm'
import { SolarScene } from './SolarScene'

export function LoginPage({ onAuthenticated }: { onAuthenticated: (session: Session) => void }) {
  return (
    <main className="auth-page">
      <div className="auth-shell">
        <section className="auth-hero">
          <div className="auth-hero__content">
            <BrandMark />
          </div>
          <SolarScene />
        </section>

        <section className="auth-panel">
          <div className="auth-panel__mobile-brand">
            <BrandMark compact />
          </div>
          <LoginForm onAuthenticated={onAuthenticated} />
        </section>
      </div>
    </main>
  )
}
