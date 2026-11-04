import { Plus, Trash2 } from 'lucide-react'
import { t, Trans } from '@/i18n'
import { uomShort } from '@/i18n/labels'
import type { Product, StockRow } from '@/lib/types'
import { fmt } from '@/lib/utils'
import { productLabel } from '@/lib/catalog'

export interface LineDraft { productId: number | ''; cases: number; loose: number }
export const emptyLine = (): LineDraft => ({ productId: '', cases: 0, loose: 0 })
export const lineQty = (l: LineDraft, p?: Product) => (p ? l.cases * (p.caseSize ?? 0) + l.loose : 0)
export const toPayload = (ls: LineDraft[]) => ls.filter((l) => l.productId !== '').map((l) => ({ productId: Number(l.productId), cases: l.cases || 0, loose: l.loose || 0 }))

/** Product / case-pack / loose-unit rows with live totals, weight and (optionally) available stock at the chosen location. */
export default function LinesEditor({ lines, onChange, products, stock, checkStock = true, readOnlyProducts }: { lines: LineDraft[]; onChange: (l: LineDraft[]) => void; products: Product[]; stock?: StockRow[]; checkStock?: boolean; readOnlyProducts?: boolean }) {
  const byId = new Map(products.map((p) => [p.id, p]))
  const set = (i: number, patch: Partial<LineDraft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const avail = (id: number | '') => (id === '' ? undefined : stock?.find((s) => s.productId === id)?.available ?? 0)
  let units = 0, boxes = 0
  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-12 gap-2 px-1 text-xs font-medium text-slate-500 sm:grid"><span className="col-span-5">{t("Product")}</span><span className="col-span-2">{t("Cases")}</span><span className="col-span-2">{t("Loose units")}</span><span className="col-span-2 text-end">{t("Total qty")}</span><span /></div>
      {lines.map((l, i) => {
        const p = l.productId === '' ? undefined : byId.get(l.productId)
        const q = lineQty(l, p); units += q; if (p?.caseSize) boxes += Math.ceil(q / p.caseSize)
        const a = avail(l.productId); const over = checkStock && stock && a !== undefined && q > a
        return (
          <div key={i} className="grid grid-cols-12 items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2">
            <div className="col-span-12 sm:col-span-5">
              <select className="input" value={l.productId} disabled={readOnlyProducts} onChange={(e) => set(i, { productId: e.target.value ? Number(e.target.value) : '' })} aria-label={t("Product")}>
                <option value="">{t("Select product…")}</option>
                {products.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{productLabel(x)}{x.weight ? ` · ${x.weight}` : ''}</option>)}
              </select>
              {p && <p className="mt-1 text-xs text-slate-500">{p.caseSize ? t('Case pack {n}', { n: p.caseSize }) : t("No case pack (loose)")} · {uomShort(p.uom)}{a !== undefined && stock ? <> · <span className={over ? 'font-medium text-red-600' : ''}><Trans k="available here: {n}" vars={{ n: fmt(a) }} /></span></> : null}</p>}
            </div>
            <input className="input col-span-4 sm:col-span-2" type="number" min={0} step={1} disabled={!!p && !p.caseSize} title={p && !p.caseSize ? t("This product has no case pack") : undefined} value={l.cases || ''} placeholder="0" onChange={(e) => set(i, { cases: Number(e.target.value) })} aria-label={t("Cases")} />
            <input className="input col-span-4 sm:col-span-2" type="number" min={0} step={p?.uom === 'kg' || p?.uom === 'm' ? 0.001 : 1} value={l.loose || ''} placeholder="0" onChange={(e) => set(i, { loose: Number(e.target.value) })} aria-label={t("Loose units")} />
            <div className="col-span-3 pt-2 text-end text-sm font-semibold sm:col-span-2">{fmt(q)}{p?.uom === 'kg' || p?.uom === 'm' ? ` ${uomShort(p.uom)}` : ''}</div>
            <button type="button" className="btn-ghost col-span-1 !p-2 text-slate-400 hover:text-red-600" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label={t("Remove line")}><Trash2 className="h-4 w-4" /></button>
          </div>
        )
      })}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button type="button" className="btn-secondary" onClick={() => onChange([...lines, emptyLine()])}><Plus className="h-4 w-4" />{t("Add product")}</button>
        <p className="text-sm text-slate-600"><Trans k="Total {n}" vars={{ n: <b>{fmt(units)}</b> }} />{boxes ? <> · <Trans k="about {n} boxes" vars={{ n: <b>{fmt(boxes)}</b> }} /></> : null}</p>
      </div>
    </div>
  )
}
