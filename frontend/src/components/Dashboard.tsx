import { ArrowUpRight, BadgeIndianRupee, ContactRound, FileUp, ImageUp, PackageSearch, ReceiptText, ShieldCheck, SunMedium } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import type { Session } from '../types'

const modules = [
  { icon: SunMedium, title: 'EPC Projects', permission: 'projects.view' },
  { icon: ReceiptText, title: 'Finance', permission: 'finance.view' },
]

export function Dashboard({ session }: { session: Session }) {
  const canAdmin = session.permissions.includes('users.view') && session.permissions.includes('roles.view')

  return (
    <section className="dashboard-content">
      <div className="dashboard-hero">
        <h1>Good to see you, {session.user.full_name.split(' ')[0]}.</h1>
      </div>

      <div className="module-grid module-grid--dashboard">
        <motion.article
          className="module-card module-card--active"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="module-card__icon"><PackageSearch size={22} /></div>
          <h2>Inventory</h2>
          <Link to="/app/inventory">Open module <ArrowUpRight size={15} /></Link>
        </motion.article>
        {modules.map(({ icon: Icon, title, permission }, index) => {
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
              <span>{enabled ? 'Available' : 'Restricted'}</span>
            </motion.article>
          )
        })}

        <motion.article
          className="module-card module-card--active"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="module-card__icon"><BadgeIndianRupee size={22} /></div>
          <h2>Solar pricing</h2>
          <Link to="/app/solar-pricing">Open module <ArrowUpRight size={15} /></Link>
        </motion.article>

        <motion.article
          className="module-card module-card--active"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24 }}
        >
          <div className="module-card__icon"><ImageUp size={22} /></div>
          <h2>Poster library</h2>
          <Link to="/app/posters">Open module <ArrowUpRight size={15} /></Link>
        </motion.article>

        <motion.article
          className="module-card module-card--active"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
        >
          <div className="module-card__icon"><FileUp size={22} /></div>
          <h2>Customer documents</h2>
          <Link to="/app/customer-documents">Open module <ArrowUpRight size={15} /></Link>
        </motion.article>

        <motion.article
          className="module-card module-card--active"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.36 }}
        >
          <div className="module-card__icon"><ContactRound size={22} /></div>
          <h2>Agent network</h2>
          {session.permissions.includes('agents.view') ? (
            <Link to="/app/agents">Open module <ArrowUpRight size={15} /></Link>
          ) : (
            <span>Restricted</span>
          )}
        </motion.article>

        <motion.article
          className="module-card module-card--active"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.42 }}
        >
          <div className="module-card__icon"><ShieldCheck size={22} /></div>
          <h2>Administration</h2>
          {canAdmin ? (
            <Link to="/app/administration">Open module <ArrowUpRight size={15} /></Link>
          ) : (
            <span>Restricted</span>
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
