import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { t, ts } from '@/i18n'
import { cn } from '@/lib/utils'
import type { PermDef } from '@/lib/types'

/**
 * Permissions as expandable main heads (one per module), each opening to a small None / View / View & Edit / Admin grid.
 * It only changes how the existing permission keys are shown: every key is still switched on or off on its own.
 * Dot colours: grey = default (no access), blue = access given, red = sensitive access.
 */
type Level = 'view' | 'edit' | 'admin'
export const levelOf = (p: PermDef): Level => (p.sensitive ? 'admin' : p.key.endsWith('.view') ? 'view' : 'edit')
const COLS: { id: 'none' | Level; label: string }[] = [
  { id: 'none', label: ts('None') }, { id: 'view', label: ts('View') }, { id: 'edit', label: ts('View & Edit') }, { id: 'admin', label: ts('Admin') },
]
const DOT = {
  grey: { ring: 'border-slate-400', dot: 'bg-slate-500' },
  blue: { ring: 'border-blue-600', dot: 'bg-blue-600' },
  red: { ring: 'border-red-600', dot: 'bg-red-600' },
}

function Radio({ name, label, checked, tone, onChange }: { name: string; label: string; checked: boolean; tone: keyof typeof DOT; onChange: () => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center justify-center p-1.5">
      <input type="radio" className="peer sr-only" name={name} checked={checked} onChange={onChange} aria-label={label} />
      <span className={cn('grid h-5 w-5 place-items-center rounded-full border-2 bg-white peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-1', checked ? DOT[tone].ring : 'border-slate-300')}>
        {checked && <span data-tone={tone} className={cn('h-2.5 w-2.5 rounded-full', DOT[tone].dot)} />}
      </span>
    </label>
  )
}

export default function PermissionMatrix({ perms, sel, onChange }: { perms: PermDef[]; sel: Set<string>; onChange: (next: Set<string>) => void }) {
  const modules = [...new Set(perms.map((p) => p.module))]
  const [open, setOpen] = useState<Set<string>>(new Set())
  const flip = (m: string) => setOpen((o) => { const n = new Set(o); if (n.has(m)) n.delete(m); else n.add(m); return n })
  const set = (key: string, on: boolean) => { const n = new Set(sel); if (on) n.add(key); else n.delete(key); onChange(n) }
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="label !mb-0">{t('What this person can do')}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-slate-500" />{t('Default (no access)')}</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-blue-600" />{t('Access given')}</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-red-600" />{t('Sensitive access')}</span>
          <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setOpen(open.size === modules.length ? new Set() : new Set(modules))}>{open.size === modules.length ? t('Collapse all') : t('Expand all')}</button>
        </div>
      </div>
      <div className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200">
        {modules.map((m) => {
          const ps = perms.filter((p) => p.module === m), given = ps.filter((p) => sel.has(p.key)), sensitive = given.filter((p) => p.sensitive).length
          const isOpen = open.has(m), all = given.length === ps.length, id = `perm-${m.replace(/\W+/g, '-')}`
          return (
            <section key={m}>
              <button type="button" aria-expanded={isOpen} aria-controls={id} onClick={() => flip(m)} className="flex w-full items-center gap-3 bg-slate-50 px-4 py-3 text-start hover:bg-slate-100">
                <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-500 transition-transform rtl:rotate-180', isOpen && 'rotate-90 rtl:rotate-90')} />
                <span className="flex-1 text-sm font-semibold">{t(m)}</span>
                {sensitive > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"><i className="h-2 w-2 rounded-full bg-red-600" />{t('{n} sensitive', { n: sensitive })}</span>}
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', given.length ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600')}>{given.length ? t('{n} of {total} allowed', { n: given.length, total: ps.length }) : t('No access')}</span>
              </button>
              {isOpen && (
                <div id={id} className="overflow-x-auto bg-white px-2 pb-3 pt-1">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead><tr>
                      <th className="px-2 py-2 text-start text-xs font-medium text-slate-500" scope="col">{t('Feature')}</th>
                      {COLS.map((c) => <th key={c.id} scope="col" className="w-24 px-1 py-2 text-center"><span className="inline-block rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 shadow-sm">{t(c.label)}</span></th>)}
                    </tr></thead>
                    <tbody>
                      {ps.map((p, i) => {
                        const lv = levelOf(p), on = sel.has(p.key)
                        return (
                          <tr key={p.key} className={i % 2 ? 'bg-white' : 'bg-slate-50/60'}>
                            <th scope="row" className="px-2 py-1 text-start font-normal text-slate-800">{t(p.label)}</th>
                            {COLS.map((c) => (
                              <td key={c.id} className="px-1 py-0.5 text-center">
                                {c.id === 'none' ? <Radio name={p.key} label={`${t(p.label)}: ${t(c.label)}`} checked={!on} tone="grey" onChange={() => set(p.key, false)} />
                                  : c.id === lv ? <Radio name={p.key} label={`${t(p.label)}: ${t(c.label)}`} checked={on} tone={p.sensitive ? 'red' : 'blue'} onChange={() => set(p.key, true)} /> : null}
                              </td>
                            ))}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div className="mt-1 flex justify-end px-2"><button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => { const n = new Set(sel); ps.forEach((p) => (all ? n.delete(p.key) : n.add(p.key))); onChange(n) }}>{all ? t('Clear this section') : t('Select all in this section')}</button></div>
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
