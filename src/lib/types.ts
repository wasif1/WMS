export interface Me { language?: 'en' | 'ur'; simpleScreen?: boolean; id: number; name: string; email: string; role: 'super_admin' | 'admin' | 'user'; permissions: string[]; mustChangePassword: boolean; totpEnabled: boolean; mfaSetupRequired: boolean; active: boolean; locked?: boolean; lastLoginAt?: string }
export type Status = 'pending' | 'approved' | 'rejected'
export interface Location { id: number; name: string; address: string; active: boolean; status?: Status }
export interface Product { id: number; sku: string; name?: string; description?: string; color?: string; size?: string; weight?: string; caseSize?: number; uom: string; reorderLevel: number; active: boolean; status?: Status }
export interface Client { id: number; alias: string; name?: string; contact?: string; address?: string; revealed: boolean }
export interface Line { productId: number; cases: number; loose: number; qty: number; actualQty?: number; difference?: number }
export interface Actor { userId: number; name: string; at: string }
export interface StockRow { productId: number; locationId: number; onHand: number; reserved: number; available: number }
export interface PermDef { key: string; label: string; module: string; sensitive?: boolean }
