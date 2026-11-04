import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { Compass } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="card mx-auto mt-16 max-w-md space-y-3 p-8 text-center">
      <Compass className="mx-auto h-10 w-10 text-slate-300" />
      <h2 className="text-lg font-semibold">{t("We couldn't find that page")}</h2>
      <p className="text-sm text-slate-500">{t("The link may be old or mistyped. Use the menu on the left, or go back to the start.")}</p>
      <Link to="/" className="btn-primary inline-flex">{t("Go to dashboard")}</Link>
    </div>
  )
}
