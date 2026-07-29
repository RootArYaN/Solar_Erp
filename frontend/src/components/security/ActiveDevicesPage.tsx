import { Laptop, LogOut, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, getActiveDevices, logoutOtherDevices, type ActiveDevice } from '../../lib/api'
import { getModuleAccess } from '../../lib/permissions'
import type { Session } from '../../types'
import { AlertDialog } from '../ui/AlertDialog'
import { EmptyState, ErrorState, LoadingSkeleton, ReadOnlyNotice } from '../ui/PageState'
import { useToast } from '../ui/ToastProvider'
import { ScrollSurface, WorkspaceHeader, WorkspacePage } from '../workspace'

export function ActiveDevicesPage({ session }: { session: Session }) {
  const [devices, setDevices] = useState<ActiveDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState('')
  const [requestId, setRequestId] = useState<string | null>(null)
  const access = getModuleAccess(session, 'security')
  const { toast } = useToast()

  async function load() {
    setLoading(true)
    setError('')
    try {
      setDevices(await getActiveDevices())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load active devices')
      setRequestId(reason instanceof ApiError ? reason.requestId : null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function revokeOthers() {
    setWorking(true)
    try {
      await logoutOtherDevices()
      setConfirmOpen(false)
      await load()
      toast({ message: 'Other devices were signed out', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not sign out other devices', variant: 'error' })
    } finally {
      setWorking(false)
    }
  }

  return <WorkspacePage className="security-page">
    <WorkspaceHeader className="security-header"><div><span>Account security</span><h1>Active devices</h1><p>Refresh tokens stay in Secure, HttpOnly, SameSite cookies. The access token is held only in memory and is cleared when this tab closes.</p></div><button className="secondary-button" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button></WorkspaceHeader>
    {access.readOnly && <ReadOnlyNotice />}
    <ScrollSurface className="security-device-surface">
    {loading ? <LoadingSkeleton rows={5} /> : error ? <ErrorState message={error} requestId={requestId} onRetry={() => void load()} /> : devices.length === 0 ? <EmptyState title="No active devices" message="The backend has not returned any sessions." /> : <div className="device-list">
      {devices.map((device) => <article key={device.id}>
        <div className="device-icon">{device.operating_system.toLowerCase().includes('ios') || device.operating_system.toLowerCase().includes('android') ? <Smartphone size={20} /> : <Laptop size={20} />}</div>
        <div><strong>{device.device_name} {device.is_current && <span>Current</span>}</strong><p>{device.browser} · {device.operating_system}</p><small>{device.approximate_location} · {device.ip_hint} · Last active {new Date(device.last_seen_at).toLocaleString('en-IN')}</small></div>
        {device.is_current && <ShieldCheck size={18} />}
      </article>)}
    </div>}
    </ScrollSurface>
    <footer className="security-actions"><div><strong>Lost a device?</strong><span>Revoke every session except this browser.</span></div><button className="danger-button" disabled={!access.canEdit || devices.filter((device) => !device.is_current).length === 0} onClick={() => setConfirmOpen(true)}><LogOut size={14} /> Log out other devices</button></footer>
    <AlertDialog open={confirmOpen} title="Log out other devices?" description="Every other refresh session will be revoked. This browser will stay signed in." confirmLabel="Log out other devices" loading={working} onCancel={() => setConfirmOpen(false)} onConfirm={revokeOthers} />
  </WorkspacePage>
}
