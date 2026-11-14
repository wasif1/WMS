import { t, ts } from '@/i18n'

/** Words for statuses / types that come from the server as codes. Defined with ts() so they are extracted for translation. */
const STATUS: Record<string, string> = {
  pending: ts('awaiting approval'), submitted: ts('awaiting approval'), approved: ts('approved'), rejected: ts('rejected'), draft: ts('draft'), in_transit: ts('in transit'),
  received: ts('received'), cancelled: ts('cancelled'), active: ts('active'), converted: ts('converted'), saved: ts('saved'), confirmed: ts('confirmed'), counting: ts('counting'),
}
export const statusLabel = (s: string) => t(STATUS[s] ?? s.replace('_', ' '))

const MOVE: Record<string, string> = {
  inbound: ts('Inbound'), transfer_out: ts('Transfer out'), transfer_in: ts('Transfer in'), reserve: ts('Reserved'), unreserve: ts('Released'), outbound: ts('Outbound'), adjustment: ts('Adjustment'), audit: ts('Audit'),
}
export const moveLabel = (type: string) => t(MOVE[type] ?? type)

const ORDER_TYPE: Record<string, string> = { inbound: ts('Inbound'), transfer: ts('Transfer'), reserve: ts('Reserve'), outbound: ts('Outbound') }
export const orderTypeLabel = (x: string) => t(ORDER_TYPE[x] ?? x)

export { uomShort } from '@/lib/uoms'

/** Activity-log action codes -> readable words (unknown codes are shown as-is). */
const ACTION: Record<string, string> = {
  'auth.login': ts('Signed in'), 'auth.logout': ts('Signed out'), 'auth.login_failed': ts('Failed sign-in'), 'auth.locked': ts('Account locked'), 'auth.password_changed': ts('Password changed'),
  'auth.totp_enabled': ts('Two-factor turned on'), 'auth.totp_disabled': ts('Two-factor turned off'),
  'user.create': ts('User created'), 'user.update': ts('User updated'), 'user.reset_password': ts('Password reset'), 'user.unlock': ts('Account unlocked'), 'user.reset_mfa': ts('Two-factor reset'),
  'product.create': ts('Product created'), 'product.request': ts('Product requested'), 'product.update': ts('Product updated'), 'product.approve': ts('Product approved'), 'product.reject': ts('Product rejected'),
  'location.create': ts('Location created'), 'location.request': ts('Location requested'), 'location.update': ts('Location updated'), 'location.approve': ts('Location approved'), 'location.reject': ts('Location rejected'),
  'client.create': ts('Client created'), 'client.update': ts('Client updated'), 'client.reveal': ts('Client details viewed'),
  'inbound.create': ts('Delivery received'), 'inbound.approve': ts('Delivery approved'), 'inbound.reject': ts('Delivery rejected'),
  'transfer.create': ts('Transfer created'), 'transfer.submit': ts('Transfer sent'), 'transfer.cancel': ts('Transfer cancelled'), 'transfer.receive': ts('Transfer received'),
  'reserve.create': ts('Stock reserved'), 'reserve.cancel': ts('Reservation released'), 'reserve.convert': ts('Reservation sent out'),
  'outbound.save': ts('Outbound order saved'), 'outbound.edit': ts('Outbound order edited'), 'outbound.confirm': ts('Outbound order confirmed'), 'outbound.cancel': ts('Outbound order cancelled'),
  'adjustment.create': ts('Stock adjusted'), 'adjustment.request': ts('Adjustment requested'), 'adjustment.approve': ts('Adjustment approved'), 'adjustment.reject': ts('Adjustment rejected'),
  'audit.create': ts('Stock count started'), 'audit.submit': ts('Stock count submitted'), 'audit.approve': ts('Stock count approved'), 'audit.reject': ts('Stock count rejected'),
  'settings.update': ts('Settings changed'), 'backup.manual': ts('Backup made'), 'backup.scheduled': ts('Scheduled backup made'), 'backup.failed': ts('Backup failed'),
}
export const actionLabel = (a: string) => (ACTION[a] ? t(ACTION[a]) : a)
