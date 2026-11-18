import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from './supabase'
import { playOrderTone } from './orderSound'

export function useLiveOrders(shopId: string, soundEnabled = false) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!supabase) return
    const channel = supabase
      .channel(`live-orders:${shopId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `shop_id=eq.${shopId}`,
      }, (payload) => {
        void queryClient.invalidateQueries({ queryKey: ['orders', shopId] })
        void queryClient.invalidateQueries({ queryKey: ['order-counts', shopId] })
        if (payload.eventType === 'INSERT') {
          const order = payload.new as { order_number?: number }
          toast.success(`New order${order.order_number ? ` #${order.order_number}` : ''} received`)
          if (soundEnabled) playOrderTone()
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'dining_tables',
        filter: `shop_id=eq.${shopId}`,
      }, () => {
        void queryClient.invalidateQueries({ queryKey: ['dining-tables', shopId] })
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          toast.error('Live order updates disconnected. Check your connection.')
        }
      })

    return () => {
      void supabase?.removeChannel(channel)
    }
  }, [queryClient, shopId, soundEnabled])
}
