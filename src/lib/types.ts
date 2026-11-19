export type ShopRole = 'owner' | 'manager' | 'cashier' | 'kitchen'

export interface Shop {
  id: string
  name: string
  slug: string
  logo_url?: string | null
  cover_url?: string | null
  address: string | null
  phone: string | null
  email: string | null
  gstin: string | null
  currency: string
  created_at: string
}

export interface ShopMember {
  id: string
  shop_id: string
  profile_id: string
  role: ShopRole
  created_at: string
}
