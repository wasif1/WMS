import { Moon, Sun } from 'lucide-react'
import { t } from '@/i18n'
import { useTheme } from '@/lib/theme'

export default function ThemeToggle({ className = '', hideLabelOnMobile = false }: { className?: string; hideLabelOnMobile?: boolean }) {
  const { theme, toggle } = useTheme()
  return (
    <button type="button" className={`btn-ghost ${className}`} onClick={toggle} aria-label={theme === 'dark' ? t("Switch to light mode") : t("Switch to dark mode")}>
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}<span className={hideLabelOnMobile ? 'hidden sm:inline' : ''}>{theme === 'dark' ? t("Light mode") : t("Dark mode")}</span>
    </button>
  )
}
