import { Download, Eye, FileDown, FileSpreadsheet, FileText, Pencil, Printer, RotateCcw, Save, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertDialog } from '../ui/AlertDialog'
import { useToast } from '../ui/ToastProvider'

type CustomerDocumentData = {
  name: string
  address: string
  consumerNo: string
  district: string
  customerNo: string
  quotationAmount: string
  plantCapacity: string
  panelSize: string
  noOfPanels: string
  panelBrand: string
  inverterBrand: string
}

type DocumentTab = 'feasibility' | 'estimate' | 'agreement' | 'quotation' | 'merged'
type MergeMode = 'all' | 'customer'
type GeneratedDocumentTab = Exclude<DocumentTab, 'merged'>

type TemplateSettings = {
  company: {
    name: string
    address: string
    phone: string
    gstin: string
    account: string
    bank: string
    ifsc: string
  }
  documents: Record<GeneratedDocumentTab, {
    title: string
    subtitle: string
    note: string
  }>
}

type SupportingDocument = {
  id: string
  type: string
  label: string
  name: string
  size: number
  mimeType: string
  url: string
}

const supportingDocumentTypes = [
  { value: 'aadhaar_front', label: 'Aadhaar Card — Front' },
  { value: 'aadhaar_back', label: 'Aadhaar Card — Back' },
  { value: 'pan_card', label: 'PAN Card' },
  { value: 'driving_licence', label: 'Driving Licence' },
  { value: 'electricity_bill', label: 'Electricity Bill' },
  { value: 'bank_proof', label: 'Bank Passbook / Cancelled Cheque' },
  { value: 'property_proof', label: 'Property / Ownership Proof' },
  { value: 'customer_photo', label: 'Customer Photo' },
  { value: 'other', label: 'Other Document' },
]

const initialData: CustomerDocumentData = {
  name: '',
  address: '',
  consumerNo: '',
  district: 'JUNAGADH',
  customerNo: '',
  quotationAmount: '',
  plantCapacity: '',
  panelSize: '',
  noOfPanels: '',
  panelBrand: '',
  inverterBrand: '',
}

const tabs: { id: DocumentTab; label: string }[] = [
  { id: 'feasibility', label: 'Feasibility Report' },
  { id: 'estimate', label: 'Bank Estimate' },
  { id: 'agreement', label: 'Agreement' },
  { id: 'quotation', label: 'Quotation' },
  { id: 'merged', label: 'Merged' },
]

const sourceAliases: Record<keyof CustomerDocumentData, string[]> = {
  name: ['name', 'customername', 'consumername', 'fullname', 'fullnameofconsumer'],
  address: ['address', 'installationaddress', 'addressofinstallation'],
  consumerNo: ['consumerno', 'consumernumber', 'pgvclconsumerno'],
  district: ['district', 'discomid'],
  customerNo: ['customerno', 'customernumber', 'quoteno', 'quotenumber'],
  quotationAmount: ['quotationamount', 'quoteamount', 'amount', 'projectcost'],
  plantCapacity: ['plantcapacity', 'capacity', 'capacitykw', 'kw'],
  panelSize: ['panelsize', 'panelsizewp', 'wp'],
  noOfPanels: ['noofpanels', 'numberofpanels', 'panels', 'panelcount'],
  panelBrand: ['panelbrand', 'pvmodulebrand', 'oem'],
  inverterBrand: ['inverterbrand', 'inverter'],
}

const templateStorageKey = 'solar-erp-document-template-v1'

const defaultTemplate: TemplateSettings = {
  company: {
    name: 'SHREE ENTERPRISE',
    address: 'KOLI PATI, AJAB, KESHOD, JUNAGADH, GUJARAT – 362229',
    phone: '+91 9574572672',
    gstin: '24BUFPK8840N1Z5',
    account: '44699708736',
    bank: 'SBI BANK / SBI AJAB',
    ifsc: 'SBIN0060163',
  },
  documents: {
    feasibility: {
      title: 'Vendor Feasibility Report',
      subtitle: 'Residential Rooftop Solar Installation',
      note: '',
    },
    estimate: {
      title: 'Estimate for Solar Rooftop',
      subtitle: 'Quotation valid for one year from the issue date',
      note: 'In case of a 3-phase meter, additional DISCOM charges may apply.',
    },
    agreement: {
      title: 'Consumer–Vendor Agreement',
      subtitle: 'PM–Surya Ghar: Muft Bijli Yojana',
      note: '',
    },
    quotation: {
      title: 'QUOTE',
      subtitle: 'Solar rooftop project quotation',
      note: 'Thank You For Your Business!',
    },
  },
}

function loadSavedTemplate() {
  try {
    const saved = localStorage.getItem(templateStorageKey)
    return saved ? { ...defaultTemplate, ...JSON.parse(saved) as TemplateSettings } : defaultTemplate
  } catch {
    return defaultTemplate
  }
}

const printStyles = `
  *{box-sizing:border-box}body{margin:0;padding:24px;background:#fff;color:#1c2733;font-family:Arial,sans-serif}
  .customer-doc-preview-output{display:grid;gap:20px}.doc-maker-preview-page{width:100%;max-width:794px;min-height:1080px;margin:0 auto;background:#fff;padding:28px;font-size:12px;line-height:1.5;break-after:page;page-break-after:always}.doc-maker-preview-page:last-child{break-after:auto;page-break-after:auto}
  .doc-preview-letterhead{display:flex;justify-content:space-between;gap:24px;padding-bottom:14px;margin-bottom:18px;border-bottom:3px solid #d99a14}
  .doc-preview-company{font-size:20px;font-weight:800;color:#14365a}.doc-preview-company-sub,.doc-preview-meta{font-size:10px;color:#68707d}
  .doc-preview-title{text-align:right;font-size:17px;font-weight:800;color:#14365a}.doc-preview-section{margin:17px 0 9px;padding-bottom:4px;border-bottom:2px solid #d99a14;color:#14365a;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px}
  .doc-preview-table{width:100%;border-collapse:collapse;margin-bottom:12px}.doc-preview-table th{padding:6px 8px;background:#14365a;color:#fff;text-align:left;font-size:9px;text-transform:uppercase}.doc-preview-table td{padding:6px 8px;border-bottom:1px solid #dde3ea;vertical-align:top}.doc-preview-table tr:nth-child(even) td{background:#f2f5fa}.doc-preview-label{width:40%;font-weight:700;color:#14365a}.doc-preview-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.doc-preview-box{padding:10px;border:1px solid #dce2e8;border-radius:7px}.doc-preview-box small{display:block;margin-bottom:5px;color:#68707d;font-weight:800;text-transform:uppercase}.doc-preview-total td{background:#14365a!important;color:#fff;font-weight:800}.doc-preview-signatures{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:28px;padding-top:16px;border-top:1px solid #dde3ea}.doc-preview-signature-line{width:180px;height:50px;border-bottom:1px solid #333}.doc-preview-signature-img{display:block;max-width:180px;max-height:56px;margin-top:6px}.doc-preview-terms{padding-left:20px}.doc-preview-terms li{margin-bottom:7px;text-align:justify}.doc-maker-supporting-page{display:flex;flex-direction:column}.doc-maker-supporting-content{flex:1;min-height:850px;display:grid;place-items:center}.doc-maker-supporting-content img,.doc-maker-supporting-content object{max-width:100%;max-height:850px}.doc-maker-supporting-content object{width:100%;height:850px}.doc-maker-supporting-page footer{display:flex;justify-content:space-between;padding-top:12px;border-top:1px solid #dde3ea}
  @page{size:A4;margin:10mm}@media print{body{padding:0}.doc-maker-preview-page{padding:0}}
`

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function parseCsvLine(line: string) {
  const cells: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      cells.push(value.trim())
      value = ''
    } else {
      value += character
    }
  }
  cells.push(value.trim())
  return cells
}

function importedRecordToData(record: Record<string, unknown>) {
  const normalized = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [normalizeHeader(key), String(value ?? '').trim()]),
  )
  const next = { ...initialData }
  ;(Object.keys(sourceAliases) as (keyof CustomerDocumentData)[]).forEach((field) => {
    const alias = sourceAliases[field].find((candidate) => normalized[candidate] !== undefined)
    if (alias) next[field] = normalized[alias]
  })
  return next
}

function today() {
  return new Intl.DateTimeFormat('en-GB').format(new Date()).replaceAll('/', '-')
}

function expiryDate() {
  const date = new Date()
  date.setFullYear(date.getFullYear() + 1)
  return new Intl.DateTimeFormat('en-GB').format(date).replaceAll('/', '-')
}

function money(value: string | number) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
    : '₹ —'
}

function SignatureBlock({ data, signature, company }: { data: CustomerDocumentData; signature: string; company: TemplateSettings['company'] }) {
  return (
    <div className="doc-preview-signatures">
      <div>
        <strong>First Party (Consumer)</strong>
        <p><b>Name:</b> {data.name || '(Consumer Name)'}</p>
        <p><b>Address:</b> {data.address || '(Consumer Address)'}</p>
        {signature ? <img className="doc-preview-signature-img" src={signature} alt="Consumer signature" /> : <div className="doc-preview-signature-line" />}
        <small>Authorized Signatory · {today()}</small>
      </div>
      <div>
        <strong>Second Party (Vendor)</strong>
        <p><b>Name:</b> {company.name}</p>
        <p><b>Address:</b> {company.address}</p>
        <div className="doc-preview-signature-line" />
        <small>Authorized Signatory · {today()}</small>
      </div>
    </div>
  )
}

function Letterhead({ title, detail, company }: { title: string; detail?: string; company: TemplateSettings['company'] }) {
  return (
    <header className="doc-preview-letterhead">
      <div>
        <div className="doc-preview-company">{company.name}</div>
        <div className="doc-preview-company-sub">{company.address}<br />Ph: {company.phone}<br />GSTIN: {company.gstin}</div>
      </div>
      <div>
        <div className="doc-preview-title">{title}</div>
        {detail && <div className="doc-preview-meta">{detail}</div>}
        <div className="doc-preview-meta">Date: {today()}</div>
      </div>
    </header>
  )
}

function TemplateNote({ note }: { note: string }) {
  return note ? <div className="doc-preview-note">{note}</div> : null
}

function FeasibilityPreview({ data, template }: { data: CustomerDocumentData; template: TemplateSettings }) {
  const checks = [
    ['Type of roof', 'Concrete slab'],
    ['Area of roof', '>500 sq. ft.'],
    ['Shading analysis', 'Shadow free area'],
    ['Feasible for fastening', 'Yes'],
    ['Existing meter details', 'Single phase'],
    ['Land suitability for earthing', 'Yes'],
    ['Grid voltage', '250 V'],
    ['Accessible roof', 'Yes'],
    ['Roof leakage', 'No'],
    ['Orientation & tilt', 'Flat surface'],
  ]
  return (
    <>
      <Letterhead title={template.documents.feasibility.title} detail={template.documents.feasibility.subtitle} company={template.company} />
      <div className="doc-preview-section">Project & Consumer Details</div>
      <table className="doc-preview-table"><tbody>
        <tr><td className="doc-preview-label">Name of Consumer</td><td><strong>{data.name || '(Consumer Name)'}</strong></td></tr>
        <tr><td className="doc-preview-label">Consumer No.</td><td>{data.consumerNo || '—'}</td></tr>
        <tr><td className="doc-preview-label">District</td><td>{data.district || 'JUNAGADH'}</td></tr>
        <tr><td className="doc-preview-label">Installation Address</td><td>{data.address || '(Address)'}</td></tr>
        <tr><td className="doc-preview-label">Panel Brand</td><td>{data.panelBrand || '—'}</td></tr>
        <tr><td className="doc-preview-label">RTS Capacity</td><td><strong>{data.plantCapacity || '—'} kW</strong></td></tr>
        <tr><td className="doc-preview-label">Feasibility Status</td><td><span className="doc-preview-status">Feasible — Yes</span></td></tr>
        <tr><td className="doc-preview-label">Project Cost</td><td><strong>{money(data.quotationAmount)}</strong></td></tr>
      </tbody></table>
      <div className="doc-preview-section">Feasibility Assessment</div>
      <table className="doc-preview-table"><tbody>
        {checks.map(([label, value]) => <tr key={label}><td className="doc-preview-label">{label}</td><td>{value}</td></tr>)}
      </tbody></table>
      <TemplateNote note={template.documents.feasibility.note} />
      <SignatureBlock data={data} signature="" company={template.company} />
    </>
  )
}

function EstimatePreview({ data, template }: { data: CustomerDocumentData; template: TemplateSettings }) {
  const company = template.company
  const specs = [
    ['PV Module', 'Monocrystalline Half Cut Bi-Facial · 25-year warranty', data.panelBrand || '—'],
    ['Inverter', 'On-grid inverter · 8-year warranty', data.inverterBrand || '—'],
    ['Protection System', 'DC & AC MCB and SPD', 'L&T'],
    ['Cable', 'Copper flexible for DC & AC', 'POLYCAB / WACAB'],
    ['Structure', 'Hot-Dip ISI GI Pipe', 'Hindustan / Stark'],
    ['Earthing Kit', 'Copper-coated rod and lightning arrester', 'Standard'],
  ]
  return (
    <>
      <Letterhead title={template.documents.estimate.title} detail={`${template.documents.estimate.subtitle} · Valid until ${expiryDate()} · QUOT-${data.customerNo || '—'}`} company={company} />
      <div className="doc-preview-grid">
        <div className="doc-preview-box"><small>Bill To</small><strong>{data.name || '(Consumer Name)'}</strong><p>{data.address || '(Address)'}</p></div>
        <div className="doc-preview-box"><small>Project Specs</small><p><b>Capacity:</b> {data.plantCapacity || '—'} kW · <b>Panels:</b> {data.noOfPanels || '—'}</p><p><b>Panel:</b> {data.panelSize || '—'} WP · {data.panelBrand || '—'}</p></div>
      </div>
      <div className="doc-preview-section">Line Items</div>
      <table className="doc-preview-table"><thead><tr><th>#</th><th>Description</th><th>KW</th><th>Amount</th></tr></thead><tbody>
        <tr><td>1</td><td>Grid Connected Rooftop Solar System</td><td>{data.plantCapacity || '—'}</td><td>{money(data.quotationAmount)}</td></tr>
        <tr><td>2</td><td>Less: GUVNL Subsidy as per norms</td><td>1.00</td><td>-₹78,000</td></tr>
        <tr><td>3</td><td>PGVCL meter and stamp charge</td><td>1.00</td><td>INQ</td></tr>
        <tr className="doc-preview-total"><td colSpan={3}>TOTAL</td><td>{money(data.quotationAmount)}</td></tr>
      </tbody></table>
      <div className="doc-preview-section">Component Specifications</div>
      <table className="doc-preview-table"><thead><tr><th>Component</th><th>Description</th><th>Make / Brand</th></tr></thead><tbody>
        {specs.map(([component, description, brand]) => <tr key={component}><td className="doc-preview-label">{component}</td><td>{description}</td><td>{brand}</td></tr>)}
      </tbody></table>
      <div className="doc-preview-section">Banking Details</div>
      <table className="doc-preview-table"><tbody>
        <tr><td className="doc-preview-label">Account Holder</td><td>{company.name}</td></tr>
        <tr><td className="doc-preview-label">Account No.</td><td>{company.account}</td></tr>
        <tr><td className="doc-preview-label">Bank / Branch</td><td>{company.bank}</td></tr>
        <tr><td className="doc-preview-label">IFSC</td><td>{company.ifsc}</td></tr>
      </tbody></table>
      <TemplateNote note={template.documents.estimate.note} />
    </>
  )
}

function AgreementPreview({ data, signature, template }: { data: CustomerDocumentData; signature: string; template: TemplateSettings }) {
  const company = template.company
  const consumerTerms = [
    'Submit the online application, net-metering request and relevant project documents.',
    'Provide secure material storage and roof access during installation and maintenance.',
    'Provide electricity and water required during installation and panel cleaning.',
    'Report malfunction during the warranty period and pay according to the agreed schedule.',
  ]
  const vendorTerms = [
    'Complete site survey, feasibility assessment, design and engineering to MNRE and DISCOM standards.',
    'Procure, supply and install compliant modules, inverter, structure, wiring and safety equipment.',
    'Provide technical catalogues, warranty certificates, test reports and project completion documents.',
    'Support net-meter approval, testing, commissioning and five years of comprehensive maintenance.',
    'Maintain required plant performance and assist with subsidy-related National Portal documentation.',
  ]
  return (
    <>
      <Letterhead title={template.documents.agreement.title} detail={template.documents.agreement.subtitle} company={company} />
      <p>This agreement is executed on <strong>{today()}</strong> for design, supply, installation, commissioning and five-year maintenance of a rooftop solar system.</p>
      <div className="doc-preview-grid">
        <div className="doc-preview-box"><small>First Party (Consumer)</small><strong>{data.name || '(Consumer Name)'}</strong><p>{data.address || '(Consumer Address)'}</p></div>
        <div className="doc-preview-box"><small>Second Party (Vendor)</small><strong>{company.name}</strong><p>{company.address}</p></div>
      </div>
      <div className="doc-preview-section">First Party Undertakings</div>
      <ol className="doc-preview-terms">{consumerTerms.map((term) => <li key={term}>{term}</li>)}</ol>
      <div className="doc-preview-section">Second Party Undertakings</div>
      <ol className="doc-preview-terms">{vendorTerms.map((term) => <li key={term}>{term}</li>)}</ol>
      <div className="doc-preview-note"><strong>Disclaimer:</strong> This agreement is between the vendor and consumer. Any dispute shall be settled mutually or according to applicable law.</div>
      <TemplateNote note={template.documents.agreement.note} />
      <SignatureBlock data={data} signature={signature} company={company} />
    </>
  )
}

function QuotationPreview({ data, template }: { data: CustomerDocumentData; template: TemplateSettings }) {
  const company = template.company
  const total = Number(data.quotationAmount) || 0
  const solarAmount = Math.max(0, total - 40000)
  const taxable = solarAmount / 1.05
  const tax = solarAmount - taxable
  return (
    <>
      <Letterhead title={template.documents.quotation.title} detail={`${template.documents.quotation.subtitle} · QUOTE # QUOT-${data.customerNo || '—'}`} company={company} />
      <div className="doc-preview-section">Customer</div>
      <table className="doc-preview-table"><tbody>
        <tr><td className="doc-preview-label">Name</td><td><strong>{data.name || '(Consumer Name)'}</strong></td></tr>
        <tr><td className="doc-preview-label">Address</td><td>{data.address || '(Address)'}</td></tr>
      </tbody></table>
      <div className="doc-preview-section">Quotation Sheet</div>
      <div className="doc-preview-table-scroll"><table className="doc-preview-table doc-preview-quotation"><thead><tr><th>#</th><th>Description</th><th>HSN/SAC</th><th>Taxable</th><th>GST</th><th>Tax</th><th>Amount</th></tr></thead><tbody>
        <tr><td>1</td><td>Solar Power Generating System ({data.plantCapacity || '—'} kW, {data.noOfPanels || '—'} × {data.panelSize || '—'} WP)</td><td>854140</td><td>{money(taxable)}</td><td>5%</td><td>{money(tax)}</td><td>{money(solarAmount)}</td></tr>
        <tr><td>2</td><td>Installation & Commissioning · {data.inverterBrand || 'On-grid'} inverter</td><td>998711</td><td>₹33,898</td><td>18%</td><td>₹6,102</td><td>₹40,000</td></tr>
        <tr className="doc-preview-total"><td colSpan={6}>TOTAL</td><td>{money(total)}</td></tr>
      </tbody></table></div>
      <div className="doc-preview-section">Bank Details</div>
      <table className="doc-preview-table"><tbody>
        <tr><td className="doc-preview-label">Name</td><td>{company.name}</td></tr>
        <tr><td className="doc-preview-label">Account No.</td><td>{company.account}</td></tr>
        <tr><td className="doc-preview-label">Bank</td><td>{company.bank}</td></tr>
        <tr><td className="doc-preview-label">IFSC</td><td>{company.ifsc}</td></tr>
      </tbody></table>
      <p className="doc-preview-thanks">Questions: {company.phone}<br /><strong>{template.documents.quotation.note || 'Thank You For Your Business!'}</strong></p>
    </>
  )
}

export function CustomerDataUploadPage() {
  const [data, setData] = useState(initialData)
  const [template, setTemplate] = useState<TemplateSettings>(loadSavedTemplate)
  const [templateDraft, setTemplateDraft] = useState<TemplateSettings>(() => structuredClone(loadSavedTemplate()))
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false)
  const [editingTemplateTab, setEditingTemplateTab] = useState<GeneratedDocumentTab>('feasibility')
  const [activeTab, setActiveTab] = useState<DocumentTab>('feasibility')
  const [mergeMode, setMergeMode] = useState<MergeMode>('all')
  const [signature, setSignature] = useState('')
  const [documentToDelete, setDocumentToDelete] = useState<SupportingDocument | null>(null)
  const [resetTemplateOpen, setResetTemplateOpen] = useState(false)
  const { toast } = useToast()
  const [supportingType, setSupportingType] = useState('aadhaar_front')
  const [customDocumentLabel, setCustomDocumentLabel] = useState('')
  const [supportingDocuments, setSupportingDocuments] = useState<SupportingDocument[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const signatureInputRef = useRef<HTMLInputElement>(null)
  const supportingInputRef = useRef<HTMLInputElement>(null)
  const supportingDocumentsRef = useRef<SupportingDocument[]>([])
  const previewRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supportingDocumentsRef.current = supportingDocuments
  }, [supportingDocuments])

  useEffect(() => () => {
    supportingDocumentsRef.current.forEach((document) => URL.revokeObjectURL(document.url))
  }, [])

  const completedFields = useMemo(
    () => Object.values(data).filter((value) => value.trim()).length,
    [data],
  )

  function setField(field: keyof CustomerDocumentData, value: string) {
    setData((current) => ({ ...current, [field]: value }))
  }

  function openTemplateEditor() {
    setEditingTemplateTab(activeTab === 'merged' ? 'feasibility' : activeTab)
    setTemplateDraft(structuredClone(template))
    setTemplateEditorOpen(true)
  }

  function updateTemplateCompany(field: keyof TemplateSettings['company'], value: string) {
    setTemplateDraft((current) => ({
      ...current,
      company: { ...current.company, [field]: value },
    }))
  }

  function updateTemplateDocument(field: 'title' | 'subtitle' | 'note', value: string) {
    setTemplateDraft((current) => ({
      ...current,
      documents: {
        ...current.documents,
        [editingTemplateTab]: { ...current.documents[editingTemplateTab], [field]: value },
      },
    }))
  }

  function useTemplateForRecord() {
    setTemplate(structuredClone(templateDraft))
    setTemplateEditorOpen(false)
    toast({ message: 'Template applied to this record', variant: 'success' })
  }

  function saveTemplatePermanently() {
    try {
      localStorage.setItem(templateStorageKey, JSON.stringify(templateDraft))
      setTemplate(structuredClone(templateDraft))
      setTemplateEditorOpen(false)
      toast({ message: 'Default template saved', variant: 'success' })
    } catch {
      toast({ message: 'Could not save the default template', variant: 'error' })
    }
  }

  async function handleCustomerFile(file?: File) {
    if (!file) return
    try {
      const text = await file.text()
      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(text) as Record<string, unknown> | Record<string, unknown>[]
        setData(importedRecordToData(Array.isArray(parsed) ? parsed[0] ?? {} : parsed))
      } else {
        const lines = text.split(/\r?\n/).filter((line) => line.trim())
        if (lines.length < 2) throw new Error('CSV needs a header and one customer row')
        const headers = parseCsvLine(lines[0])
        const values = parseCsvLine(lines[1])
        setData(importedRecordToData(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))))
      }
      toast({ message: `${file.name} imported`, variant: 'success' })
    } catch (error) {
      toast({ message: error instanceof Error ? error.message : 'Could not import this file', variant: 'error' })
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleSignature(file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast({ message: 'Select an image for the signature', variant: 'error' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setSignature(String(reader.result ?? ''))
      toast({ message: 'Signature added', variant: 'success' })
    }
    reader.onerror = () => toast({ message: 'Could not read the signature image', variant: 'error' })
    reader.readAsDataURL(file)
  }

  function handleSupportingDocuments(files?: FileList | null) {
    if (!files?.length) return
    const selectedType = supportingDocumentTypes.find((type) => type.value === supportingType)
    const label = supportingType === 'other'
      ? customDocumentLabel.trim() || 'Other Document'
      : selectedType?.label ?? 'Supporting Document'
    const accepted: SupportingDocument[] = []
    const rejected: string[] = []

    Array.from(files).forEach((file) => {
      const supported = file.type.startsWith('image/') || file.type === 'application/pdf'
      if (!supported || file.size > 10 * 1024 * 1024) {
        rejected.push(file.name)
        return
      }
      accepted.push({
        id: crypto.randomUUID(),
        type: supportingType,
        label,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        url: URL.createObjectURL(file),
      })
    })

    if (accepted.length) {
      setSupportingDocuments((current) => [...current, ...accepted])
      toast({ message: `${accepted.length} document${accepted.length === 1 ? '' : 's'} added`, variant: 'success' })
    }
    if (rejected.length) toast({ message: `Skipped: ${rejected.join(', ')}`, variant: 'warning' })
    if (supportingInputRef.current) supportingInputRef.current.value = ''
  }

  function removeSupportingDocument() {
    if (!documentToDelete) return
    setSupportingDocuments((current) => current.filter((item) => item.id !== documentToDelete.id))
    URL.revokeObjectURL(documentToDelete.url)
    toast({ message: `${documentToDelete.label} deleted`, variant: 'success' })
    setDocumentToDelete(null)
  }

  function downloadTemplate() {
    const headers = Object.keys(initialData)
    const example = ['Ramesh Patel', 'House No., Street, City, PIN', '1234567890', 'JUNAGADH', '1855', '170000', '3.2', '550', '6', 'Adani Solar', 'Solis']
    const csv = `${headers.join(',')}\n${example.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')}`
    downloadBlob(csv, 'customer-upload-template.csv', 'text/csv;charset=utf-8')
    toast({ message: 'Upload template downloaded', variant: 'success' })
  }

  function exportQuotationCsv() {
    const rows = [
      ['Customer', data.name],
      ['Address', data.address],
      ['Quote Number', `QUOT-${data.customerNo}`],
      ['Plant Capacity', `${data.plantCapacity} kW`],
      ['Panel', `${data.noOfPanels} × ${data.panelSize} WP ${data.panelBrand}`],
      ['Inverter', data.inverterBrand],
      ['Quotation Amount', data.quotationAmount],
    ]
    downloadBlob(rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n'), 'solar-quotation.csv', 'text/csv;charset=utf-8')
    toast({ message: 'Quotation CSV downloaded', variant: 'success' })
  }

  function exportWord() {
    if (!previewRef.current) return
    const html = `<html><head><meta charset="utf-8"><style>${printStyles}</style></head><body>${previewRef.current.outerHTML}</body></html>`
    downloadBlob(`\ufeff${html}`, `${activeTab}.doc`, 'application/msword')
    toast({ message: 'Word document downloaded', variant: 'success' })
  }

  function printDocument() {
    if (!previewRef.current) return
    const printWindow = window.open('', '_blank', 'width=900,height=700')
    if (!printWindow) {
      toast({ message: 'Allow pop-ups to print this document', variant: 'error' })
      return
    }
    printWindow.document.write(`<html><head><title>${tabs.find((tab) => tab.id === activeTab)?.label}</title><style>${printStyles}</style></head><body>${previewRef.current.outerHTML}</body></html>`)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => printWindow.print(), 250)
    toast({ message: 'Print preview opened', variant: 'info' })
  }

  return (
    <>
    <section className="customer-doc-page">
      <aside className="customer-doc-form-panel">
        <header className="customer-doc-form-header">
          <div><strong>Customer documents</strong></div>
          <small>{completedFields}/{Object.keys(initialData).length} fields</small>
        </header>
        <div className="customer-upload-actions">
          <button className="secondary-button" onClick={() => fileInputRef.current?.click()}><Upload size={13} /> Import data</button>
          <button className="secondary-button" onClick={downloadTemplate}><Download size={13} /> CSV template</button>
          <input ref={fileInputRef} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(event) => void handleCustomerFile(event.target.files?.[0])} />
        </div>

        <div className="customer-doc-form-scroll">
          <FormSection title="Customer Information">
            <DocField label="Full Name of Consumer *" value={data.name} onChange={(value) => setField('name', value)} />
            <DocField label="Address of Installation *" value={data.address} multiline onChange={(value) => setField('address', value)} />
            <div className="customer-doc-field-row">
              <DocField label="Consumer No. (PGVCL)" value={data.consumerNo} onChange={(value) => setField('consumerNo', value)} />
              <DocField label="District" value={data.district} onChange={(value) => setField('district', value)} />
            </div>
          </FormSection>
          <FormSection title="Quotation Details">
            <div className="customer-doc-field-row">
              <DocField label="Customer / Quote No." value={data.customerNo} onChange={(value) => setField('customerNo', value)} />
              <DocField label="Quotation Amount (₹)" value={data.quotationAmount} inputMode="decimal" onChange={(value) => setField('quotationAmount', value)} />
            </div>
          </FormSection>
          <FormSection title="System Specifications">
            <div className="customer-doc-field-row">
              <DocField label="Plant Capacity (kW)" value={data.plantCapacity} inputMode="decimal" onChange={(value) => setField('plantCapacity', value)} />
              <DocField label="Panel Size (WP)" value={data.panelSize} inputMode="numeric" onChange={(value) => setField('panelSize', value)} />
            </div>
            <div className="customer-doc-field-row">
              <DocField label="No. of Panels" value={data.noOfPanels} inputMode="numeric" onChange={(value) => setField('noOfPanels', value)} />
              <DocField label="Panel Brand" value={data.panelBrand} onChange={(value) => setField('panelBrand', value)} />
            </div>
            <DocField label="Inverter Brand" value={data.inverterBrand} onChange={(value) => setField('inverterBrand', value)} />
          </FormSection>
          <FormSection title="Customer Signature">
            <button className="customer-signature-upload" onClick={() => signatureInputRef.current?.click()}>
              {signature ? <img src={signature} alt="Uploaded customer signature" /> : <><Upload size={18} /><span>Upload signature</span></>}
            </button>
            <input ref={signatureInputRef} type="file" accept="image/*" hidden onChange={(event) => handleSignature(event.target.files?.[0])} />
          </FormSection>

          <FormSection title={`Supporting documents (${supportingDocuments.length})`}>
            <div className="supporting-doc-upload">
              <label>
                <span>Document type</span>
                <select value={supportingType} onChange={(event) => setSupportingType(event.target.value)}>
                  {supportingDocumentTypes.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}
                </select>
              </label>
              {supportingType === 'other' && (
                <label>
                  <span>Document name</span>
                  <input value={customDocumentLabel} onChange={(event) => setCustomDocumentLabel(event.target.value)} placeholder="e.g. Passport" />
                </label>
              )}
              <button className="customer-supporting-upload-button" onClick={() => supportingInputRef.current?.click()}>
                <Upload size={15} /> Upload files
              </button>
              <input
                ref={supportingInputRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                hidden
                onChange={(event) => handleSupportingDocuments(event.target.files)}
              />
              <small>Images or PDF · 10 MB max</small>
            </div>

            {supportingDocuments.length > 0 && (
              <div className="supporting-doc-list">
                {supportingDocuments.map((document) => (
                  <article key={document.id}>
                    <button className="supporting-doc-thumbnail" onClick={() => window.open(document.url, '_blank')}>
                      {document.mimeType.startsWith('image/')
                        ? <img src={document.url} alt={document.label} />
                        : <FileText size={20} />}
                    </button>
                    <div>
                      <strong>{document.label}</strong>
                      <span title={document.name}>{document.name}</span>
                      <small>{(document.size / 1024).toFixed(0)} KB</small>
                    </div>
                    <div className="supporting-doc-actions">
                      <button onClick={() => window.open(document.url, '_blank')} aria-label={`Preview ${document.name}`} title="Preview"><Eye size={13} /></button>
                      <a href={document.url} download={document.name} onClick={() => toast({ message: `Downloading ${document.name}`, variant: 'info' })} aria-label={`Download ${document.name}`} title="Download"><Download size={13} /></a>
                      <button onClick={() => setDocumentToDelete(document)} aria-label={`Delete ${document.name}`} title="Delete"><Trash2 size={13} /></button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </FormSection>
        </div>
      </aside>

      <section className="customer-doc-preview-panel">
        <header className="customer-doc-preview-toolbar">
          <nav>
            {tabs.map((tab) => <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
          </nav>
          <div>
            <button className="secondary-button" onClick={openTemplateEditor}><Pencil size={14} /> Edit template</button>
            {activeTab === 'merged' && (
              <select className="document-merge-mode" value={mergeMode} onChange={(event) => setMergeMode(event.target.value as MergeMode)}>
                <option value="all">All documents</option>
                <option value="customer">Customer documents only</option>
              </select>
            )}
            <button className="secondary-button" onClick={printDocument}><Printer size={14} /> Print / PDF</button>
            {activeTab === 'quotation'
              ? <button className="secondary-button" onClick={exportQuotationCsv}><FileSpreadsheet size={14} /> Excel CSV</button>
              : activeTab !== 'merged' && <button className="secondary-button" onClick={exportWord}><FileDown size={14} /> Word</button>}
          </div>
        </header>
        <div className="customer-doc-preview-scroll">
          <div className={`customer-doc-preview-output ${activeTab === 'merged' ? 'customer-doc-preview-output--merged' : ''}`} ref={previewRef}>
            {activeTab !== 'merged' && (
              <article className="doc-maker-preview-page">
                {activeTab === 'feasibility' && <FeasibilityPreview data={data} template={template} />}
                {activeTab === 'estimate' && <EstimatePreview data={data} template={template} />}
                {activeTab === 'agreement' && <AgreementPreview data={data} signature={signature} template={template} />}
                {activeTab === 'quotation' && <QuotationPreview data={data} template={template} />}
              </article>
            )}
            {activeTab === 'merged' && (
              <>
                {mergeMode === 'all' && (
                  <>
                    <article className="doc-maker-preview-page"><FeasibilityPreview data={data} template={template} /></article>
                    <article className="doc-maker-preview-page"><EstimatePreview data={data} template={template} /></article>
                    <article className="doc-maker-preview-page"><AgreementPreview data={data} signature={signature} template={template} /></article>
                    <article className="doc-maker-preview-page"><QuotationPreview data={data} template={template} /></article>
                  </>
                )}
                {supportingDocuments.map((document) => (
                  <article className="doc-maker-preview-page doc-maker-supporting-page" key={document.id}>
                    <Letterhead title={document.label} detail={`Customer supporting document · ${document.name}`} company={template.company} />
                    <div className="doc-maker-supporting-content">
                      {document.mimeType.startsWith('image/')
                        ? <img src={document.url} alt={document.label} />
                        : <object data={document.url} type="application/pdf" aria-label={document.label}>
                            <FileText size={36} />
                            <p>PDF preview is unavailable in this browser.</p>
                            <a href={document.url} target="_blank" rel="noreferrer">Open {document.name}</a>
                          </object>}
                    </div>
                    <footer>
                      <span>{document.label}</span>
                      <small>{document.name} · {(document.size / 1024).toFixed(0)} KB</small>
                    </footer>
                  </article>
                ))}
                {mergeMode === 'customer' && supportingDocuments.length === 0 && (
                  <div className="merged-documents-empty">
                    <FileText size={28} />
                    <strong>No documents uploaded</strong>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </section>
    {templateEditorOpen && (
      <div className="modal-layer" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setTemplateEditorOpen(false)
      }}>
        <section className="modal-card template-editor-card" role="dialog" aria-modal="true" aria-labelledby="template-editor-title">
          <header className="modal-card__header">
            <div><h2 id="template-editor-title">Edit template</h2></div>
            <button className="icon-button" onClick={() => setTemplateEditorOpen(false)} aria-label="Close template editor"><X size={17} /></button>
          </header>
          <div className="template-editor-body">
            <label className="template-editor-document-select">
              <span>Document template</span>
              <select value={editingTemplateTab} onChange={(event) => setEditingTemplateTab(event.target.value as GeneratedDocumentTab)}>
                {tabs.filter((tab): tab is { id: GeneratedDocumentTab; label: string } => tab.id !== 'merged').map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
              </select>
            </label>

            <section>
              <h3>Selected document</h3>
              <div className="template-editor-grid">
                <TemplateField label="Document title" value={templateDraft.documents[editingTemplateTab].title} onChange={(value) => updateTemplateDocument('title', value)} />
                <TemplateField label="Subtitle" value={templateDraft.documents[editingTemplateTab].subtitle} onChange={(value) => updateTemplateDocument('subtitle', value)} />
              </div>
              <TemplateField label="Custom note / terms" value={templateDraft.documents[editingTemplateTab].note} multiline onChange={(value) => updateTemplateDocument('note', value)} />
            </section>

            <section>
              <h3>Vendor header & banking</h3>
              <div className="template-editor-grid">
                <TemplateField label="Vendor name" value={templateDraft.company.name} onChange={(value) => updateTemplateCompany('name', value)} />
                <TemplateField label="Phone" value={templateDraft.company.phone} onChange={(value) => updateTemplateCompany('phone', value)} />
              </div>
              <TemplateField label="Vendor address" value={templateDraft.company.address} multiline onChange={(value) => updateTemplateCompany('address', value)} />
              <div className="template-editor-grid">
                <TemplateField label="GSTIN" value={templateDraft.company.gstin} onChange={(value) => updateTemplateCompany('gstin', value)} />
                <TemplateField label="Account number" value={templateDraft.company.account} onChange={(value) => updateTemplateCompany('account', value)} />
                <TemplateField label="Bank / branch" value={templateDraft.company.bank} onChange={(value) => updateTemplateCompany('bank', value)} />
                <TemplateField label="IFSC" value={templateDraft.company.ifsc} onChange={(value) => updateTemplateCompany('ifsc', value)} />
              </div>
            </section>
          </div>
          <footer className="template-editor-actions">
            <button className="secondary-button" onClick={() => setResetTemplateOpen(true)}><RotateCcw size={14} /> Reset</button>
            <div>
              <button className="secondary-button" onClick={useTemplateForRecord}>Apply</button>
              <button className="primary-button primary-button--compact" onClick={saveTemplatePermanently}><Save size={14} /> Save default</button>
            </div>
          </footer>
        </section>
      </div>
    )}
    <AlertDialog
      open={Boolean(documentToDelete)}
      title={`Delete ${documentToDelete?.label ?? 'document'}?`}
      confirmLabel="Delete document"
      icon="delete"
      onCancel={() => setDocumentToDelete(null)}
      onConfirm={removeSupportingDocument}
    />
    <AlertDialog
      open={resetTemplateOpen}
      title="Reset template?"
      confirmLabel="Reset template"
      variant="warning"
      icon="reset"
      onCancel={() => setResetTemplateOpen(false)}
      onConfirm={() => {
        setTemplateDraft(structuredClone(defaultTemplate))
        setResetTemplateOpen(false)
        toast({ message: 'Template reset', variant: 'success' })
      }}
    />
    </>
  )
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="customer-doc-form-section"><h2>{title}</h2>{children}</section>
}

function DocField({
  label,
  value,
  multiline = false,
  inputMode,
  onChange,
}: {
  label: string
  value: string
  multiline?: boolean
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  onChange: (value: string) => void
}) {
  return (
    <label className="customer-doc-field">
      <span>{label}</span>
      {multiline
        ? <textarea value={value} onChange={(event) => onChange(event.target.value)} />
        : <input value={value} inputMode={inputMode} onChange={(event) => onChange(event.target.value)} />}
    </label>
  )
}

function TemplateField({
  label,
  value,
  multiline = false,
  onChange,
}: {
  label: string
  value: string
  multiline?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="template-editor-field">
      <span>{label}</span>
      {multiline
        ? <textarea value={value} onChange={(event) => onChange(event.target.value)} />
        : <input value={value} onChange={(event) => onChange(event.target.value)} />}
    </label>
  )
}

function downloadBlob(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
