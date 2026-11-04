import { useAuth } from '@/auth/AuthContext'

/** True for staff on the simple one-page screen. Forms use it to show plainer words and short step-by-step help. */
export const useSimple = () => !!useAuth().user?.simpleScreen
