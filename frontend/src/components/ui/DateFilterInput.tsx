import { CalendarDays } from 'lucide-react'

type DateFilterInputProps = {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  label?: string
  className?: string
  min?: string
  max?: string
  required?: boolean
}

function formatDateForDisplay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return 'dd/mm/yy'
  return `${match[3]}/${match[2]}/${match[1].slice(-2)}`
}

export function DateFilterInput({
  value,
  onChange,
  ariaLabel,
  label,
  className = '',
  min,
  max,
  required = false,
}: DateFilterInputProps) {
  return (
    <label className={`date-filter-control ${className}`.trim()}>
      <span className="date-filter-control__copy" aria-hidden="true">
        {label && <small>{label}</small>}
        <span className="date-filter-control__value">{formatDateForDisplay(value)}</span>
      </span>
      <CalendarDays size={14} aria-hidden="true" />
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        required={required}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
