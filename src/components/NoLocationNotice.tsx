import { MapPinOff } from 'lucide-react'
import { t } from '@/i18n'
import { useAuth } from '@/auth/AuthContext'

/** Shown to someone a super admin has limited to locations but not given any yet: otherwise every list just looks empty. */
export default function NoLocationNotice() {
  const { user } = useAuth()
  if (!user || user.role === 'super_admin' || !user.locationIds || user.locationIds.length > 0) return null
  return (
    <div role="status" className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <MapPinOff className="mt-0.5 h-5 w-5 shrink-0" />
      <span><b>{t('No location access yet')}</b><br />{t('A super admin has not given you access to any location, so there is nothing to show yet. Ask them to give you access, then reload this page.')}</span>
    </div>
  )
}
