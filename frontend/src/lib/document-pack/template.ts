import type { DocumentPackTab, DocumentPackTemplate } from './types'

export const documentTabs: Array<{ key: Exclude<DocumentPackTab, 'full'>; label: string; file: string }> = [
  { key: 'feasibility', label: 'Feasibility Report', file: '1_Feasibility_Report' },
  { key: 'estimate', label: 'Bank Estimate', file: '2_Bank_Estimate' },
  { key: 'agreement', label: 'Agreement', file: '3_Consumer_Vendor_Agreement' },
  { key: 'quotation', label: 'Quotation', file: '4_Solar_Quotation' },
]

export const feasibilityChecks: Array<[string, string]> = [
  ['TYPE OF ROOF', 'CONCRETE SLAB'],
  ['AREA OF ROOF', '>500 sq. ft.'],
  ['SHADING ANALYSIS', 'SHADOW FREE AREA'],
  ['FEASIBLE FOR FASTENING', 'YES'],
  ['EXISTING METER DETAILS', 'SINGLE PHASE'],
  ['LAND SUITABILITY FOR EARTHING', 'YES'],
  ['MAX-MIN TEMPERATURE RANGE', '10°C TO 45°C'],
  ['GRID VOLTAGE', '250 V'],
  ['ACCESSIBILITY FOR WIRING', 'YES'],
  ['WORK FRIENDLY ENVIRONMENT FOR LABOUR', 'YES'],
  ['ACCESSIBLE ROOF', 'YES'],
  ['WHETHER ROOF HAS LEAKAGE', 'NO'],
  ['ORIENTATION & TILT OF ROOF', 'FLAT SURFACE'],
  ['WHETHER PREMISES HAS INVERTER INSTALLATION POINT', 'YES'],
  ['WHETHER PREMISES HAS BI-DIRECTIONAL NET METER SPACE', 'YES'],
  ['HAZARD IDENTIFICATION (PROXIMITY TO POWER LINES)', 'NO'],
  ['CONSUMER HAS ALL NECESSARY DOCUMENTS (GOVT. GUIDELINES)', 'YES'],
]

export const bankComponentSpecs: Array<[string, string, string]> = [
  ['PV Module', 'Monocrystalline Half Cut Bi-Facial | Warranty: 25 years', 'Selected panel brand'],
  ['Inverter', 'On Grid Inverter | Warranty: 08 years', 'Selected inverter brand'],
  ['Protection System', 'DC & AC MCB and SPD', 'L&T / Equivalent'],
  ['Cable', 'Copper flexible for DC & AC | Aluminium LA 16 sqmm', 'POLYCAB / WACAB'],
  ['Structure', 'Hot-Dip ISI GI Pipe 60×40 & 40×40 mm', 'Hindustan / Stark'],
  ['PVC Pipe', 'Conduit Pipe ISI Standard', 'Standard'],
  ['J Bolt', '8 mm Stainless Steel', 'Standard'],
  ['Earthing Kit', 'Copper coated 1M rod + chemical bag + Lightning Arrester', 'Standard'],
]

export const firstPartyActivities = [
  'Submit the online application at the National Portal, net-metering application, inspection request and relevant scheme documents.',
  'Provide secure storage of RTS plant material delivered at the premises until system handover.',
  'Provide roof access for installation, testing, operation and maintenance, and meter or inverter reading.',
  'Provide electricity during installation and water for cleaning the panels.',
  'Report any plant malfunction to the vendor during the warranty period.',
  'Pay according to the mutually agreed payment schedule, including approved additional site-specific work or customization.',
]

export const secondPartyActivities = [
  'Follow all safety guidelines, state regulations and MNRE technical standards. Supply, installation and commissioning remain the vendor’s responsibility.',
  'Site Survey: Visit and survey the site, prepare the project report, and assess roof feasibility, roof strength and shadow-free area. Additional customization shall be separately estimated and approved.',
  'Design & Engineering: Prepare plant design, drawings and component selection according to DISCOM, SERC and MNRE requirements.',
  'Module and Inverter: Supply eligible modules and inverters conforming to applicable MNRE standards, quality-control orders and labelling requirements.',
  'Procurement & Supply: Procure the complete system according to applicable BIS, IS and IEC standards and subsidy-eligibility requirements.',
  'Installation & Civil Work: Complete required civil, structural and electrical work while following applicable safety and BIS standards.',
  'Documentation: Provide technical catalogues, warranty certificates, BIS certificates, test reports, serial numbers, layouts, SLD, structure drawings and cable details needed for portal submission.',
  'Project Completion Report: Assist the consumer with signed PCR documents and National Portal submission.',
  'Warranty: Provide system and component warranty documents. The complete system shall carry five-year vendor support from DISCOM commissioning, subject to the agreement and manufacturer terms.',
  'Net Meter & Grid Connectivity: Assist with net-meter procurement, testing, approval and plant grid connection.',
  'Testing and Commissioning: Remain present and provide assistance during DISCOM testing and commissioning.',
  'Operation & Maintenance: Provide five years of comprehensive operation and maintenance and educate the consumer on module cleaning and system care.',
  'Insurance: Material transfer and storage insurance before commissioning remains in the vendor scope where applicable.',
  'Applicable Standard: Supply components and services meeting standards notified by MNRE and the State DISCOM.',
  'Project Cost & Payment Terms: Record the mutually agreed plant cost and milestone payment schedule in the approved quotation and ERP workflow.',
  'Dispute: Consumer and vendor shall settle disputes mutually or according to law; MNRE and the Distribution Utility are not parties to the dispute.',
  'Subsidy Documents: Provide and help upload project documents required for National Portal subsidy processing.',
  'Plant Performance: Target a Performance Ratio of 75% at commissioning and support required testing under the applicable scheme and DISCOM procedure.',
]

export const defaultDocumentPackTemplate: DocumentPackTemplate = {
  company_name: '',
  brand_name: '',
  address: '',
  gstin: '',
  phone: '',
  email: '',
  bank_details: '',
  quotation_notes: '',
  agreement_wording: '',
  footer: '',
  terms: '',
  feasibility_title: 'Vendor Feasibility Report',
  feasibility_status: 'FEASIBLE — YES',
  feasibility_note: 'Site layout images: Upload 2–4 site photographs to the PM Surya Ghar portal or the customer document checklist.',
  feasibility_checks: feasibilityChecks.map(([label, value]) => `${label} | ${value}`).join('\n'),
  estimate_title: 'Estimate for Solar Rooftop',
  estimate_note: 'T&C: Three-phase meter or site-specific DISCOM charges, additional structure height and non-standard civil work are charged only after approval.',
  component_specs: bankComponentSpecs.map(([component, description, make]) => `${component} | ${description} | ${make}`).join('\n'),
  agreement_title: 'Consumer–Vendor Agreement',
  agreement_subtitle: 'Annexure 2 · PM – Surya Ghar: Muft Bijli Yojana',
  agreement_intro: 'design, supply, installation, commissioning and five-year comprehensive maintenance of the RTS project/system along with warranty',
  first_party_activities: firstPartyActivities.join('\n'),
  second_party_activities: secondPartyActivities.join('\n'),
  agreement_disclaimer: 'This agreement is between vendor and consumer. Any dispute related to it shall not involve MNRE or the Distribution Utility except where required by law or applicable scheme procedure.',
  quotation_title: 'Solar Quotation',
  customer_signature_label: 'Customer',
  vendor_signature_label: 'Vendor',
  vendor_signatory_name: '',
  vendor_signatory_title: 'Authorized signatory',
}

export function normalizeDocumentPackTemplate(settings: Record<string, unknown> = {}): DocumentPackTemplate {
  return Object.fromEntries(
    Object.entries(defaultDocumentPackTemplate).map(([key, fallback]) => [key, String(settings[key] ?? fallback)]),
  ) as DocumentPackTemplate
}

export function templateLines(value: string, fallback: string[]): string[] {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return lines.length ? lines : fallback
}

export function templateChecks(value: string): Array<[string, string]> {
  const rows = templateLines(value, []).map((line) => {
    const [label, ...rest] = line.split('|')
    return [label.trim(), rest.join('|').trim()] as [string, string]
  }).filter(([label, result]) => label && result)
  return rows.length ? rows : feasibilityChecks
}

export function templateComponentSpecs(value: string): Array<[string, string, string]> {
  const rows = templateLines(value, []).map((line) => {
    const [component, description, ...rest] = line.split('|')
    return [component.trim(), description?.trim() ?? '', rest.join('|').trim()] as [string, string, string]
  }).filter(([component, description]) => component && description)
  return rows.length ? rows : bankComponentSpecs
}
