import { t } from '@/i18n'
import { orderTypeLabel, uomShort } from '@/i18n/labels'
import { fmt } from '@/lib/utils'

/** The one-line explanation of an owner-approval request, built here (not on the server) so it follows the language. */
export function approvalSummary(i: { type: string; details: any }): string {
  const d = i.details ?? {}
  switch (i.type) {
    case 'product':
      return [d.color, d.size, d.weight && t('weight {w}', { w: d.weight }), d.caseSize ? t('case pack {n}', { n: d.caseSize }) : t('no case pack'), t('measured in {u}', { u: uomShort(d.uom) })].filter(Boolean).join(' · ')
    case 'location':
      return d.address || t('No address')
    case 'adjustment':
      return t('{verb} {n} (system showed {before} when requested) - {reason}', { verb: d.delta > 0 ? t('Add') : t('Remove'), n: fmt(Math.abs(d.delta)), before: fmt(d.before), reason: d.reason })
    case 'audit':
      return t('{n} difference(s) across {m} counted lines', { n: d.differences?.length ?? 0, m: d.lineCount ?? 0 })
    default:
      return ''
  }
}

/** Reference column in the movement history. */
export function movementRef(m: { refType?: string; refId?: number; refName?: string; note?: string }): string {
  if (m.refType === 'audit') return m.refName ?? t('Audit #{id}', { id: m.refId ?? 0 })
  if (m.refType === 'adjustment') return m.note ?? t('Adjustment')
  if (m.refType) return t('{type} #{id}', { type: orderTypeLabel(m.refType), id: m.refId ?? 0 })
  return m.note ?? ''
}
