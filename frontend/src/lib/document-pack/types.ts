export type DocumentPackTab = 'feasibility' | 'estimate' | 'agreement' | 'quotation' | 'full'

export type DocumentPackInput = {
  customerName: string
  customerNumber: string
  projectNumber: string
  quotationNumber: string
  address: string
  district: string
  consumerNumber: string
  customerCategory: string
  plantCapacity: string
  quotationAmount: string
  panelSize: string
  numberOfPanels: string
  panelBrand: string
  inverterBrand: string
  structureType: string
  cableBrand: string
  salesPerson: string
  agreementDate: string
  validityDays: string
  notes: string
}

export type DocumentPackTemplate = {
  company_name: string
  brand_name: string
  address: string
  gstin: string
  phone: string
  email: string
  bank_details: string
  quotation_notes: string
  agreement_wording: string
  footer: string
  terms: string
  feasibility_title: string
  feasibility_status: string
  feasibility_note: string
  feasibility_checks: string
  estimate_title: string
  estimate_note: string
  component_specs: string
  agreement_title: string
  agreement_subtitle: string
  agreement_intro: string
  first_party_activities: string
  second_party_activities: string
  agreement_disclaimer: string
  quotation_title: string
  customer_signature_label: string
  vendor_signature_label: string
  vendor_signature_image: string
  vendor_signatory_name: string
  vendor_signatory_title: string
}
