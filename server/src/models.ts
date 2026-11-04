export type Role = 'super_admin' | 'admin' | 'user'

export interface User {
  id: number
  name: string
  email: string
  role: Role
  permissions: string[]
  /** staff who see the simple one-page screen (no side menu) instead of the full app */
  simpleScreen?: boolean
  passwordHash: string
  active: boolean
  mustChangePassword: boolean
  failedLogins: number
  lockedUntil?: number
  totpSecret?: string
  totpPending?: string
  totpLastStep?: number
  createdAt: string
  lastLoginAt?: string
}

export interface Session {
  userId: number
  csrf: string
  createdAt: number
  lastSeen: number
  ip?: string
  ua?: string
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
/** Everything the team submits (product, location, adjustment, audit) is reviewed by the owner before it goes live. */
export interface ApprovalInfo { status?: ApprovalStatus; submittedBy?: Actor; decidedBy?: Actor; decisionComment?: string }

export interface Location extends ApprovalInfo { id: number; name: string; address: string; active: boolean; createdAt: string }

export interface Product extends ApprovalInfo {
  id: number
  sku: string // generated, for records & analysis only
  name?: string
  description?: string
  color?: string
  size?: string
  weight?: string // free text as measured, e.g. "500g", "1.5 kg"
  caseSize?: number // units per case/box; optional (some products arrive loose)
  uom: 'unit' | 'kg' | 'm' | 'bundle' // how this product is actually measured
  reorderLevel: number
  active: boolean
  createdAt: string
}

export interface Client { id: number; alias: string; name: string; contact: string; address: string; createdAt: string }

export interface Stock { id: number; productId: number; locationId: number; onHand: number; reserved: number }

export interface Movement {
  id: number
  productId: number
  locationId: number
  type: 'inbound' | 'transfer_out' | 'transfer_in' | 'reserve' | 'unreserve' | 'outbound' | 'adjustment' | 'audit'
  onHandDelta: number
  reservedDelta: number
  onHandAfter: number
  refType?: string
  refId?: number
  userId: number
  note?: string
  at: string
}

export interface Line { productId: number; cases: number; loose: number; qty: number }
export interface Actor { userId: number; name: string; at: string }
export interface Comment { by: string; at: string; text: string }
