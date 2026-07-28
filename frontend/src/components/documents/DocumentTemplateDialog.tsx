import { Save } from 'lucide-react'
import type { FormEvent } from 'react'
import type { DocumentTemplate } from '../../erp-types'
import type { DocumentPackTemplate } from '../../lib/document-pack'
import { Modal } from '../admin/Modal'

export function DocumentTemplateDialog({
  template,
  settings,
  working,
  onClose,
  onSubmit,
}: {
  template: DocumentTemplate
  settings: DocumentPackTemplate
  working: boolean
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <Modal
      className="document-template-modal"
      title="Edit document template"
      subtitle="Controls branding, document wording, specifications, legal clauses, and signature blocks for every generated customer pack."
      onClose={onClose}
    >
      <form className="erp-form document-template-form" onSubmit={onSubmit}>
        <fieldset>
          <legend>Template and company identity</legend>
          <div className="erp-form-grid">
            <label><span>Template name</span><input name="name" defaultValue={template.name} required /></label>
            <label><span>Company name</span><input name="company_name" defaultValue={settings.company_name} /></label>
            <label><span>Brand name</span><input name="brand_name" defaultValue={settings.brand_name} /></label>
            <label><span>GSTIN</span><input name="gstin" defaultValue={settings.gstin} /></label>
            <label><span>Phone</span><input name="phone" defaultValue={settings.phone} /></label>
            <label><span>Email</span><input name="email" type="email" defaultValue={settings.email} /></label>
            <label className="erp-form-wide"><span>Company address</span><textarea name="address" defaultValue={settings.address} /></label>
            <label className="erp-form-wide"><span>Bank details</span><textarea name="bank_details" defaultValue={settings.bank_details} /></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Document titles and commercial text</legend>
          <div className="erp-form-grid">
            <label><span>Feasibility report title</span><input name="feasibility_title" defaultValue={settings.feasibility_title} /></label>
            <label><span>Feasibility status</span><input name="feasibility_status" defaultValue={settings.feasibility_status} /></label>
            <label><span>Bank estimate title</span><input name="estimate_title" defaultValue={settings.estimate_title} /></label>
            <label><span>Quotation title</span><input name="quotation_title" defaultValue={settings.quotation_title} /></label>
            <label className="erp-form-wide"><span>Feasibility note</span><textarea name="feasibility_note" defaultValue={settings.feasibility_note} /></label>
            <label className="erp-form-wide"><span>Estimate note / conditions</span><textarea name="estimate_note" defaultValue={settings.estimate_note} /></label>
            <label className="erp-form-wide"><span>Quotation notes</span><textarea name="quotation_notes" defaultValue={settings.quotation_notes} /></label>
            <label className="erp-form-wide"><span>General terms</span><textarea name="terms" defaultValue={settings.terms} /></label>
            <label className="erp-form-wide"><span>Document footer</span><input name="footer" defaultValue={settings.footer} /></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Feasibility checks and component specifications</legend>
          <div className="erp-form-grid">
            <label className="erp-form-wide">
              <span>Feasibility checks <small>one “label | value” row per line</small></span>
              <textarea className="document-template-code-field" name="feasibility_checks" defaultValue={settings.feasibility_checks} />
            </label>
            <label className="erp-form-wide">
              <span>Component specifications <small>one “component | description | make” row per line</small></span>
              <textarea className="document-template-code-field" name="component_specs" defaultValue={settings.component_specs} />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Consumer–vendor agreement</legend>
          <div className="erp-form-grid">
            <label><span>Agreement title</span><input name="agreement_title" defaultValue={settings.agreement_title} /></label>
            <label><span>Agreement subtitle</span><input name="agreement_subtitle" defaultValue={settings.agreement_subtitle} /></label>
            <label className="erp-form-wide"><span>Agreement introduction</span><textarea name="agreement_intro" defaultValue={settings.agreement_intro} /></label>
            <label className="erp-form-wide"><span>First-party activities <small>one activity per line</small></span><textarea className="document-template-list-field" name="first_party_activities" defaultValue={settings.first_party_activities} /></label>
            <label className="erp-form-wide"><span>Second-party activities <small>one activity per line</small></span><textarea className="document-template-list-field" name="second_party_activities" defaultValue={settings.second_party_activities} /></label>
            <label className="erp-form-wide"><span>Company agreement wording</span><textarea name="agreement_wording" defaultValue={settings.agreement_wording} /></label>
            <label className="erp-form-wide"><span>Agreement disclaimer</span><textarea name="agreement_disclaimer" defaultValue={settings.agreement_disclaimer} /></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Signature blocks</legend>
          <p className="document-template-help">These settings control signature captions in the preview and exported files. The customer’s signature image remains customer-specific and is uploaded from the document checklist.</p>
          <div className="erp-form-grid">
            <label><span>Customer signature label</span><input name="customer_signature_label" defaultValue={settings.customer_signature_label} /></label>
            <label><span>Customer signature line</span><input name="customer_signature_line" defaultValue={settings.customer_signature_line} /></label>
            <label><span>Vendor signature label</span><input name="vendor_signature_label" defaultValue={settings.vendor_signature_label} /></label>
            <label><span>Vendor signatory name</span><input name="vendor_signatory_name" defaultValue={settings.vendor_signatory_name} placeholder={settings.company_name || 'Company name'} /></label>
            <label className="erp-form-wide"><span>Vendor signatory title</span><input name="vendor_signatory_title" defaultValue={settings.vendor_signatory_title} /></label>
          </div>
        </fieldset>

        <footer className="erp-form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={working}><Save size={14} /> {working ? 'Saving…' : 'Save complete template'}</button>
        </footer>
      </form>
    </Modal>
  )
}
