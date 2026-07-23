import { BarChart3, Boxes, FileCheck2 } from 'lucide-react'
import type { Session } from '../types'
import { BrandMark } from './BrandMark'
import { LoginForm } from './LoginForm'
import { SolarScene } from './SolarScene'

const highlights = [
  { icon: Boxes, value: 'Live', label: 'Inventory visibility' },
  { icon: FileCheck2, value: 'Clear', label: 'Approval workflows' },
  { icon: BarChart3, value: 'Unified', label: 'Project & finance data' },
]

export function LoginPage({ onAuthenticated }: { onAuthenticated: (session: Session) => void }) {
  return (
    <main className="auth-page">
      <div className="auth-shell">
        <section className="auth-hero">
          <div className="auth-hero__content">
            <BrandMark />
            <div className="auth-hero__copy">
              <div className="eyebrow eyebrow--light">Solar EPC operating system</div>
              <h2>One clean workspace for the complete solar project lifecycle.</h2>
              <p>
                Start with secure access. Expand into CRM, quotations, projects, procurement,
                inventory, documentation, ledger and finance without rebuilding the foundation.
              </p>
            </div>
            <div className="highlight-grid">
              {highlights.map(({ icon: Icon, value, label }) => (
                <div className="highlight" key={label}>
                  <Icon size={20} />
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <SolarScene />
        </section>

        <section className="auth-panel">
          <div className="auth-panel__mobile-brand">
            <BrandMark compact />
          </div>
          <LoginForm onAuthenticated={onAuthenticated} />
          <p className="auth-panel__footer">Solar ERP · Local development workspace</p>
        </section>
      </div>
    </main>
  )
}
