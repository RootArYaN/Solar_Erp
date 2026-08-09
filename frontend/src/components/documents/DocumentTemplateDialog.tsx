import { Image, ImagePlus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { DocumentTemplate } from '../../erp-types'
import { isSignatureDataUrl, prepareVendorSignature, type DocumentPackTemplate } from '../../lib/document-pack'
import { Modal } from '../admin/Modal'

const MAX_VENDOR_SIGNATURE_BYTES = 5 * 1024 * 1024

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
  onSubmit: (values: Record<string, string>) => Promise<void>
}) {
  const formId = useId()
  const signatureInputRef = useRef<HTMLInputElement>(null)
  const [vendorSignatureImage, setVendorSignatureImage] = useState(() => isSignatureDataUrl(settings.vendor_signature_image) ? settings.vendor_signature_image : '')
  const [signatureError, setSignatureError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [preparingSignature, setPreparingSignature] = useState(false)

  async function selectVendorSignature(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_VENDOR_SIGNATURE_BYTES) {
      setSignatureError('Use a vendor signature image smaller than 5 MB.')
      return
    }
    setPreparingSignature(true)
    setSignatureError('')
    try {
      const prepared = await prepareVendorSignature(file)
      setVendorSignatureImage(prepared.dataUrl)
    } catch (reason) {
      setSignatureError(reason instanceof Error ? reason.message : 'Could not prepare the vendor signature image.')
    } finally {
      setPreparingSignature(false)
    }
  }

  function removeVendorSignature() {
    setVendorSignatureImage('')
    setSignatureError('')
  }

  async function submitTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working || preparingSignature) return

    const form = event.currentTarget
    const values = Object.fromEntries(
      Array.from(new FormData(form).entries(), ([key, value]) => [key, String(value)]),
    )
    values.name = (values.name || '').trim()

    if (values.name.length < 2) {
      setSaveError('Enter a template name with at least 2 characters.')
      ;(form.elements.namedItem('name') as HTMLInputElement | null)?.focus()
      return
    }

    const emailInput = form.elements.namedItem('email') as HTMLInputElement | null
    if (emailInput?.value && emailInput.validity.typeMismatch) {
      setSaveError('Enter a valid company email address or leave it blank.')
      emailInput.focus()
      return
    }

    setSaveError('')
    try {
      await onSubmit(values)
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'Could not save the template. Please try again.')
    }
  }

  return (
    <Modal
      className="document-template-modal"
      title="Edit document template"
      subtitle="Set company details, document text, terms, and signatures."
      onClose={onClose}
      footer={(
        <footer className="document-template-actions">
          {saveError && <span className="document-template-actions__error" role="alert">{saveError}</span>}
          <div className="document-template-actions__buttons">
            <button type="button" className="secondary-button" onClick={onClose} disabled={working}>Cancel</button>
            <button type="submit" form={formId} className="primary-button" disabled={working || preparingSignature}>
              <Save size={14} /> {preparingSignature ? 'Preparing signature…' : working ? 'Saving…' : 'Save template'}
            </button>
          </div>
        </footer>
      )}
    >
      <form
        id={formId}
        className="erp-form document-template-form"
        noValidate
        onChange={() => { if (saveError) setSaveError('') }}
        onSubmit={(event) => void submitTemplate(event)}
      >
        <fieldset>
          <legend>Template and company details</legend>
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
          <legend>Document titles and text</legend>
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
          <legend>Signatures</legend>
          <p className="document-template-help">Set signature labels and the company signature used in previews and downloads.</p>
          <div className="erp-form-grid">
            <label><span>Customer signature label</span><input name="customer_signature_label" defaultValue={settings.customer_signature_label} /></label>
            <label><span>Vendor signature label</span><input name="vendor_signature_label" defaultValue={settings.vendor_signature_label} /></label>
            <label><span>Vendor signatory name</span><input name="vendor_signatory_name" defaultValue={settings.vendor_signatory_name} placeholder={settings.company_name || 'Company name'} /></label>
            <label className="erp-form-wide"><span>Vendor signatory title</span><input name="vendor_signatory_title" defaultValue={settings.vendor_signatory_title} /></label>
            <div className="erp-form-wide document-template-signature-field">
              <span className="document-template-signature-field__label">Vendor signature image</span>
              <input type="hidden" name="vendor_signature_image" value={vendorSignatureImage} />
              <input
                ref={signatureInputRef}
                className="document-template-signature-field__input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => void selectVendorSignature(event)}
              />
              <div className={`document-template-signature${vendorSignatureImage ? ' has-image' : ''}`}>
                <div className="document-template-signature__preview">
                  {vendorSignatureImage
                    ? <img src={vendorSignatureImage} alt="Vendor signature preview" />
                    : <><Image size={22} aria-hidden="true" /><span>No vendor signature added</span></>}
                </div>
                <div className="document-template-signature__actions">
                  {!vendorSignatureImage && <button type="button" onClick={() => signatureInputRef.current?.click()} disabled={preparingSignature} aria-label="Add vendor signature" title="Add vendor signature"><ImagePlus size={16} /></button>}
                  {vendorSignatureImage && <button type="button" onClick={() => signatureInputRef.current?.click()} disabled={preparingSignature} aria-label="Replace vendor signature" title="Replace vendor signature"><RefreshCw className={preparingSignature ? 'spin' : ''} size={16} /></button>}
                  {vendorSignatureImage && <button type="button" className="is-remove" onClick={removeVendorSignature} disabled={preparingSignature} aria-label="Remove vendor signature" title="Remove vendor signature"><Trash2 size={16} /></button>}
                </div>
              </div>
              {signatureError && <small className="document-template-signature__error" role="alert">{signatureError}</small>}
              {!signatureError && <small>JPG, PNG, or WebP · saved with each generated document version</small>}
            </div>
          </div>
        </fieldset>

      </form>
    </Modal>
  )
}
