import type { CustomerFlowSnapshot } from '../../contracts/domain-contracts'

export const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
export const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
export const shortDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })

export function revision(snapshot: CustomerFlowSnapshot | null) {
  const quotation = snapshot?.quotations[0]
  return quotation?.revisions.find((row) => row.id === quotation.current_revision_id) ?? quotation?.revisions[0] ?? null
}

export function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase())
}

export function customerForm(snapshot: CustomerFlowSnapshot) {
  const contact = snapshot.customer.contacts[0]
  return {
    full_name: snapshot.customer.display_name,
    phone: contact?.phone ?? '',
    alternate_phone: snapshot.customer.alternate_phone ?? contact?.alternate_phone ?? '',
    email: contact?.email ?? '',
    billing_address: snapshot.customer.billing_address ?? '',
    site_address: snapshot.customer.site_address ?? snapshot.customer.addresses[0]?.line_1 ?? '',
    district: snapshot.customer.district ?? '',
    state: snapshot.customer.state || 'Gujarat',
    postal_code: snapshot.customer.postal_code ?? '',
    consumer_number: snapshot.customer.consumer_number ?? '',
    electricity_provider: snapshot.customer.electricity_provider ?? '',
    customer_type: snapshot.customer.customer_type,
    lead_source: snapshot.customer.lead_source ?? '',
    status: snapshot.customer.status,
  }
}
