export type OrderStatus = 'new' | 'accepted' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled'

export interface OrderItemCustomization {
  group_name: string
  option_name: string
  price_delta: number
}

export interface OrderItemAddon {
  addon_name: string
  quantity: number
  unit_price: number
}

export interface OrderItem {
  id: string
  product_name: string
  variant_name: string | null
  quantity: number
  instructions: string | null
  unit_price: number
  line_total: number
  order_item_customizations: OrderItemCustomization[]
  order_item_addons: OrderItemAddon[]
}

export interface OrderTable {
  name: string
  table_number: string
}

export interface ShopOrder {
  id: string
  shop_id: string
  order_number: number
  table_id: string | null
  customer_name: string | null
  customer_phone: string | null
  notes: string | null
  status: OrderStatus
  payment_status: string
  subtotal: number
  tax: number
  total: number
  cancellation_reason: string | null
  created_at: string
  dining_tables: OrderTable | OrderTable[] | null
  order_items: OrderItem[]
}

export const orderSelect = '*, dining_tables(name,table_number), order_items(id,product_name,variant_name,quantity,instructions,unit_price,line_total,order_item_customizations(group_name,option_name,price_delta),order_item_addons(addon_name,quantity,unit_price))'

export function firstRelation<T>(relation: T | T[] | null | undefined): T | null {
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null
}

export const orderStatusLabels: Record<OrderStatus, string> = {
  new: 'New',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
  completed: 'Completed',
  cancelled: 'Cancelled',
}
