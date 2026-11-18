import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, CheckCheck, CircleDollarSign, PackageCheck, ShoppingBasket } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { Shop } from '../lib/types'
import { supabase } from '../lib/supabase'

interface ShopNotification {
  id: string
  type: string
  title: string
  body: string | null
  entity_id: string | null
  read_at: string | null
  created_at: string
}

function notificationIcon(type: string) {
  if (type === 'new_order') return ShoppingBasket
  if (type === 'order_status') return PackageCheck
  if (type.includes('payment') || type.includes('bill')) return CircleDollarSign
  return Bell
}

export function NotificationsPage({ shop }: { shop: Shop }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const notificationsQuery = useQuery({
    queryKey: ['notifications', shop.id],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('notifications')
        .select('id,type,title,body,entity_id,read_at,created_at')
        .eq('shop_id', shop.id)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data ?? []) as ShopNotification[]
    },
  })

  const markRead = useMutation({
    mutationFn: async (id?: string) => {
      if (!supabase) throw new Error('Supabase is not configured.')
      let request = supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('shop_id', shop.id).is('read_at', null)
      if (id) request = request.eq('id', id)
      const { error } = await request
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notifications', shop.id] }),
        queryClient.invalidateQueries({ queryKey: ['notification-count', shop.id] }),
      ])
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Notification could not be updated.'),
  })

  const notifications = notificationsQuery.data ?? []

  return (
    <section className="page-content notifications-content">
      <div className="welcome-row">
        <div className="page-heading"><p className="eyebrow">KEEP UP WITH THE SHOP</p><h1>Notifications</h1><p>Order activity and updates from your workspace.</p></div>
        {notifications.some((notification) => !notification.read_at) && <button className="button button-secondary" disabled={markRead.isPending} onClick={() => markRead.mutate(undefined)}><CheckCheck size={15} /> Mark all read</button>}
      </div>
      <div className="panel notification-panel">
        {notificationsQuery.isLoading ? <div className="notification-empty">Loading notifications…</div> : notificationsQuery.isError ? <div className="notification-empty notification-error">Notifications could not be loaded. Check your connection and permissions.</div> : notifications.length ? (
          <div className="notification-list">
            {notifications.map((notification) => {
              const Icon = notificationIcon(notification.type)
              return (
                <article className={`notification-item ${notification.read_at ? '' : 'notification-unread'}`} key={notification.id}>
                  <div className="notification-icon"><Icon size={17} /></div>
                  <div className="notification-copy"><strong>{notification.title}</strong>{notification.body && <p>{notification.body}</p>}<time dateTime={notification.created_at}>{new Date(notification.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time></div>
                  <div className="notification-actions">
                    {notification.entity_id && <button className="quiet-link" onClick={() => {
                      if (!notification.read_at) markRead.mutate(notification.id)
                      navigate('/dashboard/orders')
                    }}>View order</button>}
                    {!notification.read_at && <button className="notification-read-button" title="Mark as read" aria-label={`Mark ${notification.title} as read`} onClick={() => markRead.mutate(notification.id)}><Check size={15} /></button>}
                  </div>
                </article>
              )
            })}
          </div>
        ) : <div className="notification-empty"><div className="empty-art"><Bell size={22} /></div><strong>You’re all caught up</strong><span>New order and shop updates will appear here.</span></div>}
      </div>
    </section>
  )
}
