import { ArrowUpRight, ContactRound, PackageSearch, ReceiptText, ShieldCheck, SunMedium } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import type { Session } from '../types'

const modules = [
  { icon: PackageSearch, title: 'Inventory', copy: 'Warehouses, stock movements, serials and planning.', permission: 'inventory.view' },
  { icon: SunMedium, title: 'EPC Projects', copy: 'Survey, design, procurement, installation and handover.', permission: 'projects.view' },
  { icon: ReceiptText, title: 'Finance', copy: 'Ledgers, invoices, payments, taxes and profitability.', permission: 'finance.view' },
]

export function Dashboard({ session }: { session: Session }) {
  const canAdmin = session.permissions.includes('users.view') && session.permissions.includes('roles.view')

  return (
    <section className="dashboard-content">
      <div className="dashboard-hero">
        <div className="eyebrow">Authenticated workspace</div>
        <h1>Good to see you, {session.user.full_name.split(' ')[0]}.</h1>
        <p>Your company workspace now includes identity, role administration and a working agent relationship module.</p>
      </div>

      <div className="module-grid module-grid--dashboard">
        {modules.map(({ icon: Icon, title, copy, permission }, index) => {
          const enabled = session.permissions.includes(permission)
          return (
            <motion.article
              className="module-card"
              key={title}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06 }}
            >
              <div className="module-card__icon"><Icon size={22} /></div>
              <h2>{title}</h2>
              <p>{copy}</p>
              <span>{enabled ? 'Access prepared' : 'No access assigned'}</span>
            </motion.article>
          )
        })}

        <motion.article
          className="module-card module-card--active"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
        >
          <div className="module-card__icon"><ContactRound size={22} /></div>
          <h2>Agent network</h2>
          <p>Review agent contacts, assigned customers, balances and transaction history.</p>
          {session.permissions.includes('agents.view') ? (
            <Link to="/app/agents">Open module <ArrowUpRight size={15} /></Link>
          ) : (
            <span>No access assigned</span>
          )}
        </motion.article>

        <motion.article
          className="module-card module-card--active"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24 }}
        >
          <div className="module-card__icon"><ShieldCheck size={22} /></div>
          <h2>Administration</h2>
          <p>Create company users, assign roles and control permissions from one workspace.</p>
          {canAdmin ? (
            <Link to="/app/administration">Open module <ArrowUpRight size={15} /></Link>
          ) : (
            <span>No access assigned</span>
          )}
        </motion.article>
      </div>

      <section className="access-card">
        <div>
          <span>Role</span>
          <strong>{session.roles.map((role) => role.replaceAll('_', ' ')).join(', ') || 'No assigned role'}</strong>
        </div>
        <div>
          <span>Permission count</span>
          <strong>{session.permissions.length}</strong>
        </div>
        <div>
          <span>Company code</span>
          <strong>{session.company.code}</strong>
        </div>
      </section>
    </section>
  )
}
