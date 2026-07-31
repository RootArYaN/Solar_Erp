import { SunMedium } from 'lucide-react'

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand-mark ${compact ? 'brand-mark--compact' : ''}`}>
      <div className="brand-mark__icon" aria-hidden="true">
        <SunMedium size={22} strokeWidth={1.8} />
        <span className="brand-mark__panel" />
      </div>
      <div>
        <div className="brand-mark__name">
          <span>Shree</span> <strong>Enterprise</strong>
        </div>
        {!compact && <div className="brand-mark__tagline">Powering organized growth</div>}
      </div>
    </div>
  )
}
