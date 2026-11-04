import { Languages } from 'lucide-react'
import { setLang, useLang } from '@/i18n'
import { post } from '@/lib/api'

/** One tap to switch between English and Urdu. For signed-in users the choice is also saved on their account. */
export default function LanguageToggle({ className = '', hideLabelOnMobile = false, signedIn = false }: { className?: string; hideLabelOnMobile?: boolean; signedIn?: boolean }) {
  const lang = useLang()
  const next = lang === 'ur' ? 'en' : 'ur'
  return (
    <button type="button" lang={next} className={`btn-ghost ${className}`} aria-label={next === 'ur' ? 'اردو میں تبدیل کریں (Switch to Urdu)' : 'Switch to English (انگریزی)'}
      onClick={() => { setLang(next); if (signedIn) post('/auth/language', { language: next }).catch(() => { /* preference could not be saved; the choice still applies on this device */ }) }}>
      <Languages className="h-4 w-4" /><span className={hideLabelOnMobile ? 'hidden sm:inline' : ''}>{next === 'ur' ? 'اردو' : 'English'}</span>
    </button>
  )
}
