import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Search } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Badge, Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, Table } from '@/components/ui'
import { post, put } from '@/lib/api'
import { useAction, useProducts } from '@/lib/hooks'
import type { Product } from '@/lib/types'

const num = (m: string) => z.coerce.number({ invalid_type_error: m }).min(0, 'Cannot be negative')
const schema = z.object({
  name: z.string().trim().min(1, 'Required').max(150), description: z.string().max(1000).default(''),
  color: z.string().max(40).optional(), weight: z.string().max(40).optional(),
  unitWeightKg: num('Number'), boxWeightKg: num('Number'), caseSize: z.coerce.number().int('Whole number').min(1, 'At least 1'),
  uom: z.enum(['unit', 'kg']), reorderLevel: num('Number').default(0),
})
type FormVals = z.infer<typeof schema>

export default function Products() {
  const { can } = useAuth(); const { data, isLoading } = useProducts()
  const [q, setQ] = useState(''); const [edit, setEdit] = useState<Product | 'new' | null>(null)
  const rows = (data ?? []).filter((p) => `${p.sku} ${p.name} ${p.color ?? ''} ${p.weight ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <PageHeader title="Products" subtitle="SKUs are generated automatically from the description and variation" actions={can('products.create') && <button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />Add new product</button>} />
      <div className="relative mb-4 max-w-sm"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="input pl-9" placeholder="Search SKU, name, colour…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {isLoading ? <PageLoader /> : (
        <Table head={['SKU', 'Product', 'Variation', 'Case pack', 'Weight (unit / box)', 'Status', '']} empty={rows.length === 0 && <Empty>No products yet.</Empty>}>
          {rows.map((p) => (
            <tr key={p.id} className="hover:bg-slate-50">
              <td className="td font-mono text-xs"><Link className="font-medium text-brand-700 hover:underline" to={`/products/${p.id}`}>{p.sku}</Link></td>
              <td className="td"><p className="font-medium">{p.name}</p><p className="max-w-xs truncate text-xs text-slate-500">{p.description}</p></td>
              <td className="td text-slate-600">{[p.color, p.weight].filter(Boolean).join(' · ') || '-'}</td>
              <td className="td">{p.caseSize} <span className="text-slate-400">{p.uom}</span></td>
              <td className="td text-slate-600">{p.unitWeightKg} / {p.boxWeightKg} kg</td>
              <td className="td">{p.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
              <td className="td text-right">{can('products.edit') && <button className="btn-ghost" onClick={() => setEdit(p)}>Edit</button>}</td>
            </tr>
          ))}
        </Table>
      )}
      {edit && <ProductForm product={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function ProductForm({ product, onClose }: { product?: Product; onClose: () => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<FormVals>({
    resolver: zodResolver(schema) as any,
    defaultValues: product ? { ...product, description: product.description ?? '' } : { uom: 'unit', caseSize: 1, unitWeightKg: 0, boxWeightKg: 0, reorderLevel: 0, description: '' },
  })
  const [active, setActive] = useState(product?.active ?? true)
  const save = useAction((v: FormVals) => {
    const body = { ...v, color: v.color || undefined, weight: v.weight || undefined }
    return product ? put(`/products/${product.id}`, { ...body, active }) : post('/products', body)
  }, { ok: product ? 'Product updated' : 'Product created', invalidate: ['products'], onSuccess: onClose })
  return (
    <Modal open onClose={onClose} title={product ? `Edit ${product.sku}` : 'Add new product'} wide>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Product name / description" error={errors.name?.message}><input className="input" {...register('name')} /></Field></div>
        <div className="sm:col-span-2"><Field label="Details"><textarea className="input" rows={2} {...register('description')} /></Field></div>
        <Field label="Colour variation" hint="Used in SKU"><input className="input" {...register('color')} /></Field>
        <Field label="Weight / size variation" hint="e.g. 500g, 2kg. Used in SKU"><input className="input" {...register('weight')} /></Field>
        <Field label="Case pack (units per case)" error={errors.caseSize?.message}><input className="input" type="number" {...register('caseSize')} /></Field>
        <Field label="Unit of measure"><select className="input" {...register('uom')}><option value="unit">Units (whole)</option><option value="kg">Kilograms</option></select></Field>
        <Field label="Product weight (kg)" error={errors.unitWeightKg?.message}><input className="input" type="number" step="any" {...register('unitWeightKg')} /></Field>
        <Field label="Box weight (kg)" error={errors.boxWeightKg?.message}><input className="input" type="number" step="any" {...register('boxWeightKg')} /></Field>
        <Field label="Reorder level" hint="Low-stock alert on the dashboard" error={errors.reorderLevel?.message}><input className="input" type="number" {...register('reorderLevel')} /></Field>
        {product && <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active</label>}
        <div className="sm:col-span-2"><ErrorBox error={save.error} /></div>
        <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={save.isPending}>{save.isPending && <Spinner />}Save</button></div>
      </form>
    </Modal>
  )
}
