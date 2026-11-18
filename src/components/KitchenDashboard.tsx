import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock3, Flame, Volume2, VolumeX } from 'lucide-react'
import { toast } from 'sonner'
import type { Shop } from '../lib/types'
import { supabase } from '../lib/supabase'
import { firstRelation, orderSelect, type OrderStatus, type ShopOrder } from '../lib/orders'
import { useLiveOrders } from '../lib/useLiveOrders'
import { playOrderTone } from '../lib/orderSound'

const kitchenStatuses: OrderStatus[] = ['new', 'accepted', 'preparing', 'ready']

const kitchenActions: Partial<Record<OrderStatus, { next: OrderStatus; label: string }>> = {
  new: { next: 'accepted', label: 'Accept order' },
  accepted: { next: 'preparing', label: 'Start preparing' },
  preparing: { next: 'ready', label: 'Mark ready' },
}

function minutesSince(timestamp: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000))
  return minutes === 0 ? 'Just now' : `${minutes} min`
}

export function KitchenDashboard({ shop }: { shop: Shop }) {
  const queryClient = useQueryClient()
  const [soundEnabled, setSoundEnabled] = useState(false)
  useLiveOrders(shop.id, soundEnabled)

  const ordersQuery = useQuery({
    queryKey: ['orders', shop.id],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('orders')
        .select(orderSelect)
        .eq('shop_id', shop.id)
        .in('status', kitchenStatuses)
        .order('created_at', { ascending: true })
        .limit(100)
      if (error) throw error
      return (data ?? []) as unknown as ShopOrder[]
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ order, status }: { order: ShopOrder; status: OrderStatus }) => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { error } = await supabase.rpc('update_order_status', {
        target_shop_id: shop.id,
        target_order_id: order.id,
        next_status: status,
        cancel_reason: null,
      })
      if (error) throw error
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['orders', shop.id] })
      toast.success(`Order #${variables.order.order_number} updated`)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Order status could not be updated.'),
  })

  const orders = ordersQuery.data ?? []
  const columns = useMemo(() => ({
    incoming: orders.filter((order) => order.status === 'new'),
    inProgress: orders.filter((order) => ['accepted','preparing'].includes(order.status)),
    ready: orders.filter((order) => order.status === 'ready'),
  }), [orders])

  return (
    <section className="page-content kitchen-content">
      <div className="welcome-row">
        <div className="page-heading">
          <p className="eyebrow">BACK OF HOUSE</p>
          <h1>Kitchen display</h1>
          <p>Keep the line moving. Updates sync with the order desk in real time.</p>
        </div>
        <div className="live-order-tools">
          <span className="realtime-pill"><span className="live-dot" /> Live updates</span>
          <button className={`button ${soundEnabled ? 'button-primary' : 'button-secondary'}`} onClick={() => {
            if (!soundEnabled) playOrderTone()
            setSoundEnabled((enabled) => !enabled)
          }}>{soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}{soundEnabled ? 'Sound on' : 'Enable sound'}</button>
        </div>
      </div>
      <div className="kitchen-summary">
        <div><Flame size={17} /><strong>{columns.incoming.length + columns.inProgress.length}</strong><span>To prepare</span></div>
        <div><Check size={17} /><strong>{columns.ready.length}</strong><span>Ready to serve</span></div>
        <span className="kitchen-summary-help">Orders appear here as soon as they’re placed.</span>
      </div>
      {ordersQuery.isLoading ? <div className="panel kitchen-empty">Loading kitchen orders…</div> : ordersQuery.isError ? <div className="panel kitchen-empty kitchen-error">Orders could not be loaded. Check your connection and permissions.</div> : orders.length ? (
        <div className="kitchen-board">
          <KitchenColumn title="Incoming" subtitle="New tickets" count={columns.incoming.length} orders={columns.incoming} pending={updateStatus.isPending} onAdvance={(order, status) => updateStatus.mutate({ order, status })} />
          <KitchenColumn title="On the line" subtitle="Being prepared" count={columns.inProgress.length} orders={columns.inProgress} pending={updateStatus.isPending} onAdvance={(order, status) => updateStatus.mutate({ order, status })} />
          <KitchenColumn title="Ready" subtitle="Call for pickup / serve" count={columns.ready.length} orders={columns.ready} pending={updateStatus.isPending} onAdvance={(order, status) => updateStatus.mutate({ order, status })} />
        </div>
      ) : <div className="panel kitchen-empty"><div className="empty-art"><Flame size={23} /></div><strong>All caught up</strong><span>New and active tickets will show up here.</span></div>}
    </section>
  )
}

function KitchenColumn({ title, subtitle, count, orders, pending, onAdvance }: {
  title: string
  subtitle: string
  count: number
  orders: ShopOrder[]
  pending: boolean
  onAdvance: (order: ShopOrder, status: OrderStatus) => void
}) {
  return (
    <section className="kitchen-column">
      <header className="kitchen-column-header"><div><h2>{title}</h2><span>{subtitle}</span></div><b>{count}</b></header>
      {orders.length ? orders.map((order) => {
        const table = firstRelation(order.dining_tables)
        const action = kitchenActions[order.status]
        return (
          <article className={`kitchen-ticket kitchen-ticket-${order.status}`} key={order.id}>
            <header><div><span className="kitchen-order-number">#{order.order_number}</span><strong>{table ? `Table ${table.table_number}` : order.customer_name || 'Pickup'}</strong></div><span className="kitchen-time"><Clock3 size={12} />{minutesSince(order.created_at)}</span></header>
            <ul>{order.order_items.map((item) => (
              <li key={item.id}>
                <div><b>{item.quantity}×</b><strong>{item.product_name}{item.variant_name ? ` · ${item.variant_name}` : ''}</strong></div>
                {item.order_item_customizations.map((customization, index) => <small key={`${item.id}:${index}`}>{customization.group_name}: {customization.option_name}</small>)}
                {item.order_item_addons.map((addon, index) => <small key={`${item.id}:addon:${index}`}>+ {addon.addon_name} × {addon.quantity}</small>)}
                {item.instructions && <small className="kitchen-instruction">Note: {item.instructions}</small>}
              </li>
            ))}</ul>
            {order.notes && <div className="kitchen-customer-note">Customer note: {order.notes}</div>}
            {action
              ? <button className="button button-primary kitchen-action" disabled={pending} onClick={() => onAdvance(order, action.next)}>{action.label} <Check size={14} /></button>
              : <div className="kitchen-ready-label"><Check size={14} /> Ready to serve</div>}
          </article>
        )
      }) : <div className="kitchen-column-empty">No tickets right now</div>}
    </section>
  )
}
