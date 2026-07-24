import { ArrowUpRight, BadgeIndianRupee, ContactRound, FileUp, ImageUp, PackageSearch, ReceiptText, ShieldCheck, SunMedium, UsersRound } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { hasEveryPermission, hasPermission, PERMISSIONS } from '../lib/permissions'
import type { Session } from '../types'

const modules = [
  { icon: UsersRound, title: 'Customer workflow', permission: PERMISSIONS.customers.view, to: '/app/customers' },
  { icon: PackageSearch, title: 'Inventory', permission: PERMISSIONS.inventory.view, to: '/app/inventory' },
  { icon: SunMedium, title: 'EPC Projects', permission: PERMISSIONS.projects.view },
  { icon: ReceiptText, title: 'Finance', permission: 'finance.view' },
  { icon: BadgeIndianRupee, title: 'Solar pricing', permission: PERMISSIONS.pricing.view, to: '/app/solar-pricing' },
  { icon: ImageUp, title: 'Poster library', permission: PERMISSIONS.posters.view, to: '/app/posters' },
  { icon: FileUp, title: 'Customer documents', permission: PERMISSIONS.documents.view, to: '/app/customer-documents' },
  { icon: ContactRound, title: 'Agent network', permission: PERMISSIONS.agents.view, to: '/app/agents' },
  { icon: ShieldCheck, title: 'Administration', permission: PERMISSIONS.users.view, to: '/app/administration', extraPermissions: [PERMISSIONS.roles.view] },
]

export function Dashboard({ session }: { session: Session }) {
  return (
    <section className="dashboard-content">
      <div className="dashboard-hero"><h1>Good to see you, {session.user.full_name.split(' ')[0]}.</h1></div>
      <div className="module-grid module-grid--dashboard">
        {modules.map(({ icon: Icon, title, permission, to, extraPermissions }, index) => {
          const enabled = extraPermissions ? hasEveryPermission(session, [permission, ...extraPermissions]) : hasPermission(session, permission)
          return <motion.article className={`module-card ${enabled && to ? 'module-card--active' : ''}`} key={title} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.045 }}>
            <div className="module-card__icon"><Icon size={22} /></div><h2>{title}</h2>
            {enabled && to ? <Link to={to}>Open module <ArrowUpRight size={15} /></Link> : <span>{enabled ? 'Backend route pending' : 'Restricted'}</span>}
          </motion.article>
        })}
      </div>
      <section className="access-card"><div><span>Role</span><strong>{session.role.replaceAll('_', ' ') || 'No assigned role'}</strong></div><div><span>Permission count</span><strong>{session.permissions.length}</strong></div><div><span>Company code</span><strong>{session.company.code}</strong></div></section>
    </section>
  )
}
