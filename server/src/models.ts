export type Role = 'super_admin' | 'admin' | 'user'

export interface User {
  id: number
  name: string
  email: string
  role: Role
  permissions: string[]
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

export interface Location { id: number; name: string; address: string; active: boolean; createdAt: string }

export interface Product {
  id: number
  sku: string
  name: string
  description: string
  color?: string
  weight?: string // variation label e.g. "500g"
  unitWeightKg: number
  boxWeightKg: number
  caseSize: number // units per case
  uom: 'unit' | 'kg'
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
