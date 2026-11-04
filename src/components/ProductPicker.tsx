import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { Product } from '@/lib/types'
import { productLabel, variationOf } from '@/lib/catalog'

/** Type-ahead search by product NAME and variation (colour / size). SKU is deliberately not searched or shown. */
export default function ProductPicker({ products, value, onChange, placeholder = 'Search by product name…' }: { products: Product[]; value: number | ''; onChange: (id: number | '') => void; placeholder?: string }) {
  const [q, setQ] = useState(''), [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const selected = products.find((p) => p.id === value)
  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return products.filter((p) => p.active && words.every((w) => `${p.name ?? ''} ${variationOf(p)} ${p.weight ?? ''}`.toLowerCase().includes(w))).slice(0, 50)
  }, [products, q])
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          className="input pl-9 pr-8" role="combobox" aria-expanded={open} aria-label="Product" placeholder={placeholder}
          value={open ? q : selected ? productLabel(selected) : q}
          onFocus={() => { setOpen(true); setQ('') }} onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        />
        {value !== '' && <button type="button" className="absolute right-2 top-2 text-slate-400 hover:text-slate-700" aria-label="Clear product" onClick={() => { onChange(''); setQ('') }}><X className="h-4 w-4" /></button>}
      </div>
      {open && (
        <ul role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No products match “{q}”</li>}
          {results.map((p) => (
            <li key={p.id} role="option" aria-selected={p.id === value}>
              <button type="button" className="flex w-full flex-col px-3 py-2 text-left hover:bg-slate-100" onClick={() => { onChange(p.id); setOpen(false); setQ('') }}>
                <span className="text-sm font-medium">{p.name || 'Unnamed product'}</span>
                <span className="text-xs text-slate-500">{[variationOf(p), p.weight].filter(Boolean).join(' · ') || 'no variation'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
