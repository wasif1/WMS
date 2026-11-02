import { useClients } from '@/lib/hooks'
import { EyeOff } from 'lucide-react'

export default function ClientSelect({ value, onChange, optional }: { value: number | ''; onChange: (v: number | '') => void; optional?: boolean }) {
  const { data = [] } = useClients()
  return (
    <div>
      <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value) || '')} aria-label="Client">
        <option value="">{optional ? 'No client (optional)' : 'Select client…'}</option>
        {data.map((c) => <option key={c.id} value={c.id}>{c.alias}{c.revealed && c.name ? ` — ${c.name}` : ''}</option>)}
      </select>
      {data.some((c) => !c.revealed) && <p className="mt-1 flex items-center gap-1 text-xs text-slate-400"><EyeOff className="h-3 w-3" />Client identities are hidden - shown as aliases</p>}
    </div>
  )
}
export const clientLabel = (c?: { alias: string; name?: string; revealed: boolean } | null) => (c ? (c.revealed && c.name ? `${c.alias} · ${c.name}` : c.alias) : '-')
