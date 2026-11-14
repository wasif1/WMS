import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { t, ts } from '@/i18n'
import { cn } from '@/lib/utils'
import type { PermDef } from '@/lib/types'

/**
 * One permission table. The column names (None / View / View & Edit / Admin) are always showing and stay pinned while scrolling.
 * Each main head (module) has its own radio per column; clicking the head opens its detailed features, each with its own radios.
 * It only changes how the existing permission keys are shown: every key is still switched on or off on its own.
 * Dot colours: grey = default (no access), blue = access given, red = sensitive access.
 */
type Level = 'view' | 'edit' | 'admin'
type Now = 'none' | Level | 'custom'
export const levelOf = (p: PermDef): Level => (p.sensitive ? 'admin' : p.key.endsWith('.view') ? 'view' : 'edit')
const COLS: { id: 'none' | Level; label: string }[] = [
  { id: 'none', label: ts('None') }, { id: 'view', label: ts('View') }, { id: 'edit', label: ts('View & Edit') }, { id: 'admin', label: ts('Admin') },
]
const DOT = {
  grey: { ring: 'border-slate-400', dot: 'bg-slate-500' },
  blue: { ring: 'border-blue-600', dot: 'bg-blue-600' },
  red: { ring: 'border-red-600', dot: 'bg-red-600' },
}

/** What a whole head means at each level: View = the view keys, View & Edit = + the everyday edit keys, Admin = + the sensitive ones. */
function ladder(ps: PermDef[]) {
  const V = ps.filter((p) => levelOf(p) === 'view'), E = ps.filter((p) => levelOf(p) === 'edit'), S = ps.filter((p) => levelOf(p) === 'admin')
  const keys = (lv: 'none' | Level) => (lv === 'none' ? [] : lv === 'view' ? V : lv === 'edit' ? [...V, ...E] : [...V, ...E, ...S]).map((p) => p.key)
  const has = (lv: 'none' | Level) => lv === 'none' || (lv === 'view' ? V.length > 0 : lv === 'edit' ? E.length > 0 : S.length > 0)
  const now = (sel: Set<string>): Now => {
    const got = ps.filter((p) => sel.has(p.key)).map((p) => p.key).sort().join()
    if (!got) return 'none'
    for (const lv of ['view', 'edit', 'admin'] as Level[]) if (has(lv) && keys(lv).sort().join() === got) return lv
    return 'custom'
  }
  return { keys, has, now }
}

function Radio({ name, label, checked, tone, onChange }: { name: string; label: string; checked: boolean; tone: keyof typeof DOT; onChange: () => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center justify-center p-1.5">
      <input type="radio" className="peer sr-only" name={name} checked={checked} onChange={onChange} aria-label={label} />
      <span className={cn('grid h-[15px] w-[15px] place-items-center rounded-full border bg-white peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-1', checked ? DOT[tone].ring : 'border-slate-300')}>
        {checked && <span data-tone={tone} className={cn('h-[7px] w-[7px] rounded-full', DOT[tone].dot)} />}
      </span>
    </label>
  )
}

type Place = { id: number; name: string }
/** `places` (+ `placeSel`) adds a "Location access" section under the Locations head: one row per location, so a super admin can give a person just one of them. */
export default function PermissionMatrix({ perms, sel, onChange, places, placeSel, onPlaceChange, unrestricted }: { perms: PermDef[]; sel: Set<string>; onChange: (next: Set<string>) => void; places?: Place[]; placeSel?: Set<number>; onPlaceChange?: (next: Set<number>) => void; unrestricted?: boolean }) {
  const modules = [...new Set(perms.map((p) => p.module))]
  const [open, setOpen] = useState<Set<string>>(new Set())
  const flip = (m: string) => setOpen((o) => { const n = new Set(o); if (n.has(m)) n.delete(m); else n.add(m); return n })
  const setKey = (key: string, on: boolean) => { const n = new Set(sel); if (on) n.add(key); else n.delete(key); onChange(n) }
  const withPlaces = (m: string) => m === 'Locations' && !!places && !!placeSel && !!onPlaceChange
  const setPlace = (id: number, on: boolean) => { const n = new Set(placeSel); if (on) n.add(id); else n.delete(id); onPlaceChange?.(n) }
  let band = 0
  const shade = () => (band++ % 2 ? 'bg-white' : 'bg-slate-50')
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-slate-500" />{t('Default (no access)')}</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-blue-600" />{t('Access given')}</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-red-600" />{t('Sensitive access')}</span>
        <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setOpen(open.size === modules.length ? new Set() : new Set(modules))}>{open.size === modules.length ? t('Collapse all') : t('Expand all')}</button>
      </div>
      <div className="overflow-x-auto rounded-md border border-slate-200 sm:overflow-visible">
        <table className="w-full min-w-[40rem] border-collapse text-[13px]">
          <thead className="sticky -top-4 z-10">
            <tr className="bg-slate-100">
              <th scope="col" className="border-b border-slate-200 px-3 py-2.5 text-start text-sm font-bold text-slate-900">{t('What this person can do')}</th>
              {COLS.map((c) => <th key={c.id} scope="col" className="w-28 border-b border-slate-200 px-1 py-2.5 text-center"><span className="inline-block rounded-md border border-slate-300 bg-white px-3 py-0.5 text-[11px] font-semibold text-slate-700 shadow-sm">{t(c.label)}</span></th>)}
            </tr>
          </thead>
          {modules.map((m) => {
            const ps = perms.filter((p) => p.module === m), g = ladder(ps), now = g.now(sel), isOpen = open.has(m)
            const given = ps.filter((p) => sel.has(p.key)).length, sensitive = ps.filter((p) => p.sensitive && sel.has(p.key)).length, id = `perm-${m.replace(/\W+/g, '-')}`
            const pick = (lv: 'none' | Level) => { const n = new Set(sel); ps.forEach((p) => n.delete(p.key)); g.keys(lv).forEach((k) => n.add(k)); onChange(n) }
            return (
              <tbody key={m} id={id}>
                <tr className={shade()}>
                  <th scope="row" className="px-3 py-1 font-normal">
                    <button type="button" aria-expanded={isOpen} aria-controls={id} onClick={() => flip(m)} className="flex w-full items-center gap-2 rounded text-start hover:text-brand-700">
                      <ChevronRight className={cn('h-4 w-4 shrink-0 text-slate-500 transition-transform rtl:rotate-180', isOpen && 'rotate-90 rtl:rotate-90')} />
                      <span className="flex-1" />
                      {sensitive > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700"><i className="h-1.5 w-1.5 rounded-full bg-red-600" />{t('{n} sensitive', { n: sensitive })}</span>}
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', now === 'custom' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'bg-slate-100 text-slate-500')}>{now === 'custom' ? t('Custom') + ' · ' : ''}{given ? t('{n} of {total} allowed', { n: given, total: ps.length }) : t('No access')}</span>
                      {withPlaces(m) && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">{unrestricted ? t('All locations') : placeSel!.size ? t('{n} of {total} locations', { n: placeSel!.size, total: places!.length }) : t('No locations')}</span>}
                      <span className="font-bold text-slate-900">{t(m)}</span>
                    </button>
                  </th>
                  {COLS.map((c) => (
                    <td key={c.id} className="px-1 text-center">
                      {g.has(c.id) && <Radio name={`head-${m}`} label={`${t(m)}: ${t(c.label)}`} checked={now === c.id} tone={c.id === 'none' ? 'grey' : c.id === 'admin' ? 'red' : 'blue'} onChange={() => pick(c.id)} />}
                    </td>
                  ))}
                </tr>
                {isOpen && ps.map((p) => {
                  const lv = levelOf(p), on = sel.has(p.key)
                  return (
                    <tr key={p.key} className={shade()}>
                      <th scope="row" className="py-0.5 pe-3 ps-9 text-end font-normal text-slate-700">{t(p.label)}</th>
                      {COLS.map((c) => (
                        <td key={c.id} className="px-1 text-center">
                          {c.id === 'none' ? <Radio name={p.key} label={`${t(p.label)}: ${t(c.label)}`} checked={!on} tone="grey" onChange={() => setKey(p.key, false)} />
                            : c.id === lv ? <Radio name={p.key} label={`${t(p.label)}: ${t(c.label)}`} checked={on} tone={p.sensitive ? 'red' : 'blue'} onChange={() => setKey(p.key, true)} /> : null}
                        </td>
                      ))}
                    </tr>
                  )
                })}
                {isOpen && withPlaces(m) && (<>
                  <tr className={shade()}>
                    <th colSpan={5} scope="colgroup" className="px-3 pb-1 pt-3 text-start">
                      <span className="text-[13px] font-bold text-slate-900">{t('Location access')}</span>
                      <span className="ms-2 text-xs font-normal text-slate-500">{unrestricted ? t('Right now this person can use every location, including new ones. Choose below to limit them.') : t('This person can only see and work with the locations marked here.')}</span>
                    </th>
                  </tr>
                  {[{ id: -1, name: t('All locations') }, ...places!].map((pl) => {
                    const all = pl.id === -1, on = all ? places!.length > 0 && places!.every((x) => placeSel!.has(x.id)) : placeSel!.has(pl.id)
                    const flip = (v: boolean) => (all ? onPlaceChange!(v ? new Set(places!.map((x) => x.id)) : new Set()) : setPlace(pl.id, v))
                    return (
                      <tr key={pl.id} className={shade()}>
                        <th scope="row" className={cn('py-0.5 pe-3 ps-9 text-end', all ? 'font-semibold text-slate-800' : 'font-normal text-slate-700')}>{pl.name}</th>
                        {COLS.map((c) => (
                          <td key={c.id} className="px-1 text-center">
                            {c.id === 'none' ? <Radio name={`place-${pl.id}`} label={`${pl.name}: ${t(c.label)}`} checked={!on} tone="grey" onChange={() => flip(false)} />
                              : c.id === 'edit' ? <Radio name={`place-${pl.id}`} label={`${pl.name}: ${t(c.label)}`} checked={on} tone="blue" onChange={() => flip(true)} /> : null}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                  {places!.length === 0 && <tr><td colSpan={5} className="px-3 py-2 text-center text-xs text-slate-500">{t('No locations have been added yet.')}</td></tr>}
                </>)}
              </tbody>
            )
          })}
        </table>
      </div>
    </div>
  )
}
