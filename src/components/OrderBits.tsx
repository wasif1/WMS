import { useState, type ReactNode } from 'react'
import { Table } from './ui'
import type { Actor, Line, Product } from '@/lib/types'
import { fmt, fmtDate } from '@/lib/utils'

export function LinesTable({ lines, products, extra }: { lines: Line[]; products: Product[]; extra?: { head: string; cell: (l: Line) => ReactNode }[] }) {
  const byId = new Map(products.map((p) => [p.id, p]))
  return (
    <Table head={['SKU', 'Product', 'Cases', 'Loose', 'Qty', ...(extra?.map((e) => e.head) ?? [])]}>
      {lines.map((l) => { const p = byId.get(l.productId); return (
        <tr key={l.productId}><td className="td font-mono text-xs">{p?.sku ?? l.productId}</td><td className="td">{p?.name}</td><td className="td">{l.cases}</td><td className="td">{l.loose}</td><td className="td font-semibold">{fmt(l.qty)}</td>{extra?.map((e) => <td key={e.head} className="td">{e.cell(l)}</td>)}</tr>
      ) })}
    </Table>
  )
}
export const Who = ({ a, label }: { a?: Actor; label: string }) => a ? <p className="text-sm"><span className="text-slate-500">{label}:</span> <b>{a.name}</b> <span className="text-slate-400">· {fmtDate(a.at)}</span></p> : null

/** Prompts for a comment; used when quantities differ or when rejecting. */
export function useComment(initial = '') { const [c, setC] = useState(initial); return { c, setC, reset: () => setC('') } }
