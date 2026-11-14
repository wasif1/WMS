import { useState } from 'react'
import { uomShort } from '@/i18n/labels'
import { t } from '@/i18n'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { Plus, Search } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { Badge, Empty, ErrorBox, Field, Modal, PageHeader, PageLoader, Spinner, Table, useToast, SimpleSteps } from '@/components/ui'
import { post, put } from '@/lib/api'
import { useSimple } from '@/lib/simple'
import { useAction, useProducts } from '@/lib/hooks'
import { variationOf } from '@/lib/catalog'
import { BUILTIN_UOMS, uomLabel, useUoms } from '@/lib/uoms'
import type { Product } from '@/lib/types'

interface FormVals { name: string; description: string; color: string; size: string; weight: string; caseSize: string; uom: Product['uom']; reorderLevel: string }

export default function Products() {
  const { can } = useAuth(); const { data, isLoading, error, refetch } = useProducts()
  const [q, setQ] = useState(''); const [edit, setEdit] = useState<Product | 'new' | null>(null)
  const owner = can('approvals.manage')
  const rows = (data ?? []).filter((p) => `${p.name ?? ''} ${p.color ?? ''} ${p.size ?? ''} ${p.weight ?? ''} ${p.sku}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <PageHeader title={t("Products")} subtitle={t("Only approved products appear here. SKUs are generated automatically.")} actions={can('products.create') && <button className="btn-primary" onClick={() => setEdit('new')}><Plus className="h-4 w-4" />{owner ? t("Add new product") : t("Submit new product")}</button>} />
      <div className="relative mb-4 max-w-sm"><Search className="absolute start-3 top-2.5 h-4 w-4 text-slate-400" /><input className="input ps-9" placeholder={t("Search name, colour, size…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <ErrorBox error={error} onRetry={() => refetch()} />
      {isLoading ? <PageLoader /> : error ? null : (
        <Table head={[t("Product"), t("Variation"), t("Case Pack"), t("Weight"), t("SKU"), t("Status"), '']} empty={rows.length === 0 && <Empty>{t("No approved products yet.")}</Empty>}>
          {rows.map((p) => (
            <tr key={p.id} className="hover:bg-slate-50">
              <td className="td"><Link className="font-medium text-brand-700 hover:underline" to={`/products/${p.id}`}>{p.name || t("Unnamed product")}</Link><p className="max-w-xs truncate text-xs text-slate-500">{p.description}</p></td>
              <td className="td text-slate-600">{variationOf(p) || '-'}</td>
              <td className="td">{p.caseSize ? <>{p.caseSize} <span className="text-slate-400">{t("per box")}</span></> : <span className="text-slate-400">{t("loose")}</span>}</td>
              <td className="td text-slate-600">{p.weight || '-'}</td>
              <td className="td font-mono text-xs text-slate-500">{p.sku}</td>
              <td className="td">{p.active ? <Badge tone="green">{t("Active")}</Badge> : <Badge>{t("Inactive")}</Badge>}</td>
              <td className="td text-end">{can('products.edit') && <button className="btn-ghost" onClick={() => setEdit(p)}>{t("Edit")}</button>}</td>
            </tr>
          ))}
        </Table>
      )}
      {edit && <ProductForm product={edit === 'new' ? undefined : edit} owner={owner} onClose={() => setEdit(null)} />}
    </>
  )
}

const num = (v: string) => (v.trim() === '' ? undefined : Number(v))

export function ProductForm({ product, owner, onClose }: { product?: Product; owner: boolean; onClose: () => void }) {
  const simple = useSimple()
  const toast = useToast()
  const { register, handleSubmit, watch } = useForm<FormVals>({
    defaultValues: { name: product?.name ?? '', description: product?.description ?? '', color: product?.color ?? '', size: product?.size ?? '', weight: product?.weight ?? '', caseSize: product?.caseSize?.toString() ?? '', uom: product?.uom ?? 'unit', reorderLevel: product?.reorderLevel?.toString() ?? '' },
  })
  const [active, setActive] = useState(product?.active ?? true)
  const uoms = useUoms()
  const uom = watch('uom')
  const save = useAction((v: FormVals) => {
    const body = { name: v.name, description: v.description, color: v.color, size: v.size, weight: v.weight, caseSize: num(v.caseSize) ?? null, uom: v.uom, reorderLevel: num(v.reorderLevel) ?? 0 }
    return product ? put(`/products/${product.id}`, { ...body, active }) : post('/products', body)
  }, {
    invalidate: ['products', 'approvals'],
    onSuccess: (r: Product) => { toast('ok', product ? t("Product updated") : r.status === 'pending' ? t("Submitted - the product appears after the owner approves it") : t("Product created")); onClose() },
  })
  return (
    <Modal open onClose={onClose} title={product ? t('Edit {name}', { name: product.name ?? t('product') }) : simple ? t("Add a new product") : owner ? t("Add new product") : t("Submit new product for approval")} wide>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="grid gap-4 sm:grid-cols-2">
        {simple && <div className="sm:col-span-2"><SimpleSteps steps={[t('Fill in only what you know. Nothing is compulsory.'), t('Type how the product is counted (units, kg, metres or bundles).'), t('Press the blue button. The owner will check it before it appears.')]} /></div>}
        <p className="text-xs text-slate-500 sm:col-span-2">{t('Nothing here is mandatory - fill in what applies to this product and measure it the way it is actually handled.')}{!product && !owner && ' ' + t('The owner reviews it before it goes live.')}</p>
        <div className="sm:col-span-2"><Field label={t("Product name")}><input className="input" {...register('name')} /></Field></div>
        <div className="sm:col-span-2"><Field label={t("Details")}><textarea className="input" rows={2} {...register('description')} /></Field></div>
        <Field label={t("Colour")} hint={t("Part of the variation, used in the SKU")}><input className="input" {...register('color')} /></Field>
        <Field label={t("Size")} hint={t("Part of the variation, used in the SKU")}><input className="input" {...register('size')} /></Field>
        <Field label={t("Weight")} hint={t("e.g. 500 g, 1.5 kg - entered once")}><input className="input" {...register('weight')} /></Field>
        <Field label={t("Measured by")} hint={t("How this product is counted")}><select className="input" {...register('uom')}>{(uoms.data ?? BUILTIN_UOMS).map((u) => <option key={u.key} value={u.key}>{uomLabel(u.key)}</option>)}</select></Field>
        <Field label={t("Case pack (units per box)")} hint={t("Leave empty for products that arrive loose")}><input className="input" type="number" min={1} step={1} {...register('caseSize')} /></Field>
        <Field label={t("Reorder level")} hint={uom === 'unit' ? t("Optional") : t('Optional, in {unit}', { unit: uomShort(uom) })}><input className="input" type="number" min={0} {...register('reorderLevel')} /></Field>
        {product && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t("Active")}</label>}
        <div className="sm:col-span-2"><ErrorBox error={save.error} /></div>
        <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className="btn-secondary" onClick={onClose}>{t("Cancel")}</button><button className="btn-primary" disabled={save.isPending}>{save.isPending && <Spinner />}{product ? t("Save") : owner ? t("Create product") : simple ? t("Send to the owner") : t("Submit for approval")}</button></div>
      </form>
    </Modal>
  )
}
