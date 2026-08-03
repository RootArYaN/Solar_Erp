import type { HTMLAttributes, ReactNode } from 'react'

interface FieldProps extends Omit<HTMLAttributes<HTMLLabelElement>, 'prefix'> {
  label: ReactNode
  children: ReactNode
  hint?: ReactNode
  error?: ReactNode
  prefix?: ReactNode
  suffix?: ReactNode
  hideLabel?: boolean
  compact?: boolean
}

export function Field({
  label,
  children,
  hint,
  error,
  prefix,
  suffix,
  hideLabel = false,
  compact = false,
  className = '',
  ...props
}: FieldProps) {
  return (
    <label
      {...props}
      className={[
        'ui-field',
        compact ? 'ui-field--compact' : '',
        error != null ? 'ui-field--error' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      <span className={hideLabel ? 'ui-field__label ui-field__label--hidden' : 'ui-field__label'}>{label}</span>
      <span className="ui-field__control">
        {prefix != null && <span className="ui-field__affix" aria-hidden="true">{prefix}</span>}
        {children}
        {suffix != null && <span className="ui-field__affix" aria-hidden="true">{suffix}</span>}
      </span>
      {error != null
        ? <span className="ui-field__message ui-field__message--error">{error}</span>
        : hint != null
          ? <span className="ui-field__message">{hint}</span>
          : null}
    </label>
  )
}
