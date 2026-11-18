import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from './supabase'

export function useLiveNotifications(shopId: string) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!supabase) return
    const channel = supabase
      .channel(`live-notifications:${shopId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `shop_id=eq.${shopId}`,
      }, () => {
        void queryClient.invalidateQueries({ queryKey: ['notifications', shopId] })
        void queryClient.invalidateQueries({ queryKey: ['notification-count', shopId] })
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          toast.error('Live notifications disconnected. Check your connection.')
        }
      })

    return () => {
      void supabase?.removeChannel(channel)
    }
  }, [queryClient, shopId])
}
