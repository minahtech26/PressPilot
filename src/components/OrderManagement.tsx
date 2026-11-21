import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock3, Eye, Search, ShoppingBasket, Volume2, VolumeX, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Shop, ShopRole } from '../lib/types'
import { supabase } from '../lib/supabase'
import { firstRelation, orderSelect, orderStatusLabels, type OrderStatus, type ShopOrder } from '../lib/orders'

const filters: Array<{ value: OrderStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All orders' },
  { value: 'new', label: 'New' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready', label: 'Ready' },
  { value: 'served', label: 'Served' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(value)
  } catch {
    return `${currency} ${Number(value).toFixed(2)}`
  }
}

function elapsed(when: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(when).getTime()) / 1000))
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  return `${Math.floor(seconds / 3600)} hr ago`
}

function nextStatus(status: OrderStatus): OrderStatus | null {
  const transitions: Partial<Record<OrderStatus, OrderStatus>> = {
    new: 'accepted',
    accepted: 'preparing',
    preparing: 'ready',
    ready: 'served',
    served: 'completed',
  }
  return transitions[status] ?? null
}

function actionLabel(status: OrderStatus) {
  const labels: Partial<Record<OrderStatus, string>> = {
    new: 'Accept order',
    accepted: 'Start preparing',
    preparing: 'Mark ready',
    ready: 'Mark served',
    served: 'Complete order',
  }
  return labels[status] ?? ''
}

export function OrderManagement({ shop, currency, role, soundEnabled, onToggleSound }: { shop: Shop; currency: string; role: ShopRole; soundEnabled: boolean; onToggleSound: () => void }) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selectedOrder, setSelectedOrder] = useState<ShopOrder | null>(null)
  const [cancelOrder, setCancelOrder] = useState<ShopOrder | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const canCancelOrders = role !== 'kitchen'

  const ordersQuery = useQuery({
    queryKey: ['orders', shop.id],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('orders')
        .select(orderSelect)
        .eq('shop_id', shop.id)
        .order('created_at', { ascending: false })
        .limit(150)
      if (error) throw error
      return (data ?? []) as unknown as ShopOrder[]
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ order, status, reason }: { order: ShopOrder; status: OrderStatus; reason?: string }) => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { error } = await supabase.rpc('update_order_status', {
        target_shop_id: shop.id,
        target_order_id: order.id,
        next_status: status,
        cancel_reason: reason ?? null,
      })
      if (error) throw error
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders', shop.id] }),
        queryClient.invalidateQueries({ queryKey: ['order-counts', shop.id] }),
      ])
      setSelectedOrder(null)
      setCancelOrder(null)
      setCancelReason('')
      toast.success(`Order #${variables.order.order_number} ${orderStatusLabels[variables.status].toLowerCase()}`)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Order status could not be updated.'),
  })

  const counts = useMemo(() => {
    const values: Record<string, number> = { all: ordersQuery.data?.length ?? 0 }
    for (const order of ordersQuery.data ?? []) values[order.status] = (values[order.status] ?? 0) + 1
    return values
  }, [ordersQuery.data])

  const filteredOrders = (ordersQuery.data ?? []).filter((order) => {
    const table = firstRelation(order.dining_tables)
    const searchable = [
      order.order_number,
      order.customer_name,
      order.customer_phone,
      table?.table_number,
      table?.name,
      ...order.order_items.map((item) => item.product_name),
    ].filter(Boolean).join(' ').toLowerCase()
    return (filter === 'all' || order.status === filter) && searchable.includes(search.trim().toLowerCase())
  })

  function changeStatus(order: ShopOrder, status: OrderStatus) {
    updateStatus.mutate({ order, status })
  }

  return (
    <section className="page-content orders-content">
      <div className="welcome-row">
        <div className="page-heading">
          <p className="eyebrow">LIVE ORDER FLOW</p>
          <h1>Orders</h1>
          <p>Follow each order from the first tap to the handoff.</p>
        </div>
        <div className="live-order-tools">
          <span className="realtime-pill"><span className="live-dot" /> Live updates</span>
          <button className={`button ${soundEnabled ? 'button-primary' : 'button-secondary'}`} onClick={onToggleSound}><span className="sound-icon">{soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}</span>{soundEnabled ? 'Sound on' : 'Enable sound'}</button>
        </div>
      </div>
      <div className="order-summary-strip">
        <div><span className="summary-dot summary-busy" /><strong>{counts.new ?? 0}</strong><span>New</span></div>
        <div><span className="summary-dot summary-preparing" /><strong>{counts.preparing ?? 0}</strong><span>Preparing</span></div>
        <div><span className="summary-dot summary-ready" /><strong>{counts.ready ?? 0}</strong><span>Ready</span></div>
        <span className="summary-strip-note">Showing the latest 150 orders</span>
      </div>
      <div className="panel orders-panel">
        <div className="orders-toolbar">
          <div className="order-filters">
            {filters.map((item) => <button key={item.value} className={filter === item.value ? 'order-filter active' : 'order-filter'} onClick={() => setFilter(item.value)}>{item.label}<span>{counts[item.value] ?? 0}</span></button>)}
          </div>
          <label className="menu-search order-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Order, customer, table…" /></label>
        </div>
        {ordersQuery.isLoading ? <div className="order-empty">Loading live orders…</div> : ordersQuery.isError ? <div className="order-empty order-error">Orders could not be loaded. Check your connection and permissions.</div> : filteredOrders.length ? (
          <div className="order-list">
            {filteredOrders.map((order) => {
              const table = firstRelation(order.dining_tables)
              const next = nextStatus(order.status)
              return (
                <article className={`order-card ${order.status === 'new' ? 'order-card-new' : ''}`} key={order.id}>
                  <div className="order-card-primary">
                    <div className="order-number-line"><strong>#{order.order_number}</strong>{order.status === 'new' && <span className="new-order-pip">NEW</span>}</div>
                    <span className={`order-status-pill order-status-${order.status}`}>{orderStatusLabels[order.status]}</span>
                  </div>
                  <div className="order-card-customer"><strong>{table ? `${table.name} · Table ${table.table_number}` : order.customer_name || 'Pickup order'}</strong><span>{order.customer_phone || (table ? 'Dine in' : 'No phone provided')}</span></div>
                  <div className="order-card-items"><strong>{order.order_items.reduce((count, item) => count + item.quantity, 0)} items</strong><span>{order.order_items.slice(0, 2).map((item) => `${item.quantity}× ${item.product_name}`).join(' · ')}{order.order_items.length > 2 ? ` · +${order.order_items.length - 2} more` : ''}</span></div>
                  <div className="order-card-time"><Clock3 size={13} /><span>{elapsed(order.created_at)}</span></div>
                  <div className="order-card-total"><strong>{money(Number(order.total), currency)}</strong><span>{order.payment_status === 'paid' ? 'Paid' : 'Unpaid'}</span></div>
                  <div className="order-card-actions">
                    <button className="button button-secondary button-small" onClick={() => setSelectedOrder(order)}><Eye size={14} /> Details</button>
                    {next && <button className="button button-primary button-small" disabled={updateStatus.isPending} onClick={() => changeStatus(order, next)}>{actionLabel(order.status)} <Check size={14} /></button>}
                    {canCancelOrders && ['new', 'accepted', 'preparing', 'ready'].includes(order.status) && <button className="order-cancel-button" onClick={() => { setCancelOrder(order); setCancelReason('') }}>Cancel</button>}
                  </div>
                </article>
              )
            })}
          </div>
        ) : <div className="order-empty"><div className="empty-art"><ShoppingBasket size={23} /></div><strong>{search || filter !== 'all' ? 'No matching orders' : 'Waiting for your first order'}</strong><span>{search || filter !== 'all' ? 'Try a different search or status filter.' : 'Customer QR orders will appear here as soon as they are placed.'}</span></div>}
      </div>
      {selectedOrder && <OrderDetails order={selectedOrder} currency={currency} onClose={() => setSelectedOrder(null)} onStatus={(status) => changeStatus(selectedOrder, status)} pending={updateStatus.isPending} />}
      {cancelOrder && <div className="checkout-overlay order-dialog-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCancelOrder(null) }}>
        <section className="checkout-modal order-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-order-heading">
          <div className="checkout-head"><div><p className="eyebrow">ORDER #{cancelOrder.order_number}</p><h2 id="cancel-order-heading">Cancel this order?</h2></div><button className="icon-button" onClick={() => setCancelOrder(null)} aria-label="Close"><X size={19} /></button></div>
          <p className="muted">The cancellation reason will be saved in the order history.</p>
          <label className="form-field"><span>Reason for cancellation</span><textarea rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} maxLength={250} placeholder="For example, item unavailable" /></label>
          <div className="order-dialog-actions"><button className="button button-secondary" onClick={() => setCancelOrder(null)}>Keep order</button><button className="button button-danger" disabled={cancelReason.trim().length < 3 || updateStatus.isPending} onClick={() => updateStatus.mutate({ order: cancelOrder, status: 'cancelled', reason: cancelReason.trim() })}>{updateStatus.isPending ? 'Cancelling…' : 'Cancel order'} <X size={15} /></button></div>
        </section>
      </div>}
    </section>
  )
}

function OrderDetails({ order, currency, onClose, onStatus, pending }: { order: ShopOrder; currency: string; onClose: () => void; onStatus: (status: OrderStatus) => void; pending: boolean }) {
  const query = useQuery({
    queryKey: ['order-history', order.shop_id ?? '', order.id],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('order_status_history')
        .select('from_status,to_status,reason,created_at')
        .eq('order_id', order.id)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data
    },
  })
  const table = firstRelation(order.dining_tables)
  const next = nextStatus(order.status)
  return (
    <div className="checkout-overlay order-dialog-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="checkout-modal order-detail-modal" role="dialog" aria-modal="true" aria-labelledby="order-detail-heading">
        <div className="checkout-head"><div><p className="eyebrow">ORDER DETAILS · {elapsed(order.created_at)}</p><h2 id="order-detail-heading">Order #{order.order_number}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close order details"><X size={19} /></button></div>
        <div className="order-detail-meta"><span className={`order-status-pill order-status-${order.status}`}>{orderStatusLabels[order.status]}</span><strong>{table ? `${table.name} · Table ${table.table_number}` : order.customer_name || 'Pickup order'}</strong><span>{order.customer_phone || 'No phone provided'}</span></div>
        <div className="order-detail-items">{order.order_items.map((item) => (
          <div className="order-detail-item" key={item.id}>
            <div className="order-detail-item-head"><strong>{item.quantity} × {item.product_name}{item.variant_name ? ` · ${item.variant_name}` : ''}</strong><span>{money(Number(item.line_total), currency)}</span></div>
            {item.order_item_customizations.map((customization, index) => <small key={`${item.id}:custom:${index}`}>{customization.group_name}: {customization.option_name}</small>)}
            {item.order_item_addons.map((addon, index) => <small key={`${item.id}:addon:${index}`}>+ {addon.addon_name} × {addon.quantity}</small>)}
            {item.instructions && <small className="order-instructions">Note: {item.instructions}</small>}
          </div>
        ))}</div>
        {order.notes && <div className="order-notes"><strong>Customer note</strong><span>{order.notes}</span></div>}
        {order.cancellation_reason && <div className="order-notes order-cancelled-note"><strong>Cancellation reason</strong><span>{order.cancellation_reason}</span></div>}
        <div className="order-detail-totals"><span>Subtotal <strong>{money(Number(order.subtotal), currency)}</strong></span><span>Tax <strong>{money(Number(order.tax), currency)}</strong></span><span>Total <strong>{money(Number(order.total), currency)}</strong></span></div>
        <div className="order-history"><strong>Order history</strong>{query.isLoading ? <small>Loading history…</small> : query.isError ? <small>History could not be loaded.</small> : (query.data ?? []).map((entry, index) => <div key={`${entry.created_at}:${index}`}><i /><span>{entry.from_status ? `${orderStatusLabels[entry.from_status as OrderStatus]} → ` : ''}{orderStatusLabels[entry.to_status as OrderStatus]}{entry.reason ? ` · ${entry.reason}` : ''}</span><small>{new Date(entry.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</small></div>)}</div>
        {next && <button className="button button-primary button-wide" disabled={pending} onClick={() => onStatus(next)}>{actionLabel(order.status)} <Check size={15} /></button>}
      </section>
    </div>
  )
}
