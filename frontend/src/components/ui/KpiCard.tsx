import type { HTMLAttributes, ReactNode } from 'react'

export type KpiCardTone = 'accent' | 'navy' | 'success' | 'danger' | 'neutral'

interface KpiCardProps extends HTMLAttributes<HTMLElement> {
  icon?: ReactNode
  label: ReactNode
  value: ReactNode
  note?: ReactNode
  action?: ReactNode
  tone?: KpiCardTone
}

export function KpiCard({
  icon,
  label,
  value,
  note,
  action,
  tone = 'accent',
  className = '',
  ...props
}: KpiCardProps) {
  return (
    <article {...props} className={['ui-kpi-card', `ui-kpi-card--${tone}`, icon == null ? 'ui-kpi-card--no-icon' : '', className].filter(Boolean).join(' ')}>
      {icon != null && <span className="ui-kpi-card__icon" aria-hidden="true">{icon}</span>}
      <div className="ui-kpi-card__content">
        <span className="ui-kpi-card__label">{label}</span>
        <strong className="ui-kpi-card__value">{value}</strong>
        {note != null && <small className="ui-kpi-card__note">{note}</small>}
      </div>
      {action != null && <div className="ui-kpi-card__action">{action}</div>}
    </article>
  )
}
