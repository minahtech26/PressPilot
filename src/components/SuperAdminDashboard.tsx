import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowLeft, ChevronLeft, ChevronRight, LogOut, Plus, RefreshCw, Search, ShieldCheck, Store, X } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'

interface MonitoredShop {
  id: string
  name: string
  slug: string
  is_active: boolean
  created_at: string
  member_count: number
  available_products: number
  orders_today: number
  open_orders: number
  last_order_at: string | null
}

interface PlatformReport {
  summary: {
    total_shops: number
    active_shops: number
    inactive_shops: number
    orders_today: number
    open_orders: number
  }
  page: number
  page_size: number
  filtered_shop_count: number
  shops: MonitoredShop[]
}

interface PlatformAnalytics {
  summary: {
    orders_7d: number
    shops_with_orders_7d: number
    new_shops_7d: number
  }
  daily_orders: Array<{ day: string; orders: number }>
}

interface NewShopForm {
  name: string
  phone: string
  email: string
  address: string
}

function localDate(value: string | null, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) {
  if (!value) return 'No orders yet'
  return new Date(value).toLocaleString('en-IN', options)
}

export function SuperAdminDashboard({ user }: { user: User }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [createShopOpen, setCreateShopOpen] = useState(false)
  const [newShop, setNewShop] = useState<NewShopForm>({ name: '', phone: '', email: '', address: '' })
  const reportQuery = useQuery({
    queryKey: ['super-admin-dashboard', page, search],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { data, error } = await supabase.rpc('get_super_admin_dashboard', {
        page_number: page,
        page_size: 25,
        shop_search: search.trim(),
      })
      if (error) throw error
      if (!data || typeof data !== 'object') throw new Error('The platform dashboard returned an invalid response.')
      return data as PlatformReport
    },
    retry: false,
  })
  const analyticsQuery = useQuery({
    queryKey: ['super-admin-analytics'],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { data, error } = await supabase.rpc('get_super_admin_analytics')
      if (error) throw error
      if (!data || typeof data !== 'object') throw new Error('The platform analytics returned an invalid response.')
      return data as PlatformAnalytics
    },
    retry: false,
  })
  const createShopMutation = useMutation({
    mutationFn: async (values: NewShopForm) => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { data, error } = await supabase.rpc('super_admin_create_shop', {
        shop_name: values.name.trim(),
        shop_phone: values.phone.trim() || null,
        shop_email: values.email.trim() || null,
        shop_address: values.address.trim() || null,
      })
      if (error) throw error
      return data
    },
    onSuccess: async () => {
      setCreateShopOpen(false)
      setNewShop({ name: '', phone: '', email: '', address: '' })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['super-admin-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['super-admin-analytics'] }),
      ])
      toast.success('Shop created.')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not create shop.'),
  })
  const shopStatusMutation = useMutation({
    mutationFn: async ({ shopId, active }: { shopId: string; active: boolean }) => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { error } = await supabase.rpc('super_admin_set_shop_active', { target_shop_id: shopId, active })
      if (error) throw error
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['super-admin-dashboard'] })
      toast.success(variables.active ? 'Shop reactivated.' : 'Shop deactivated.')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not update shop status.'),
  })

  const report = reportQuery.data
  const analytics = analyticsQuery.data
  const pageCount = Math.max(1, Math.ceil((report?.filtered_shop_count ?? 0) / (report?.page_size ?? 25)))

  async function signOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) {
      toast.error(error.message)
      return
    }
    navigate('/login', { replace: true })
  }

  function toggleShopStatus(shop: MonitoredShop) {
    const active = !shop.is_active
    const message = active
      ? `Reactivate ${shop.name}? Its public menu and shop access will become available again.`
      : `Deactivate ${shop.name}? Its data will be kept, but the public menu and shop access will be disabled.`
    if (window.confirm(message)) shopStatusMutation.mutate({ shopId: shop.id, active })
  }

  return (
    <main className="super-admin-page">
      <header className="super-admin-topbar">
        <a className="super-admin-brand" href="/admin"><span><ShieldCheck size={19} /></span><strong>Freshdesk</strong><small>Platform admin</small></a>
        <div className="super-admin-account"><span title={user.email ?? undefined}>{user.email}</span><button className="button button-secondary" onClick={signOut}><LogOut size={15} /> Sign out</button></div>
      </header>
      <section className="super-admin-content">
        <div className="super-admin-heading">
          <div><p className="eyebrow">PLATFORM OVERVIEW</p><h1>Shop monitoring</h1><p>Monitor shop activity across the platform. Customer and staff personal information isn’t shown here.</p></div>
          <div className="super-admin-heading-actions">
            <button className="button button-primary" onClick={() => setCreateShopOpen(true)}><Plus size={15} /> Add shop</button>
            <button className="super-admin-live" onClick={() => { void reportQuery.refetch(); void analyticsQuery.refetch() }} disabled={reportQuery.isFetching || analyticsQuery.isFetching}><RefreshCw size={14} /> {reportQuery.isFetching || analyticsQuery.isFetching ? 'Refreshing…' : 'Refresh data'}</button>
          </div>
        </div>

        {reportQuery.isLoading ? <div className="super-admin-state">Loading platform data…</div>
          : reportQuery.isError ? <div className="super-admin-state super-admin-error">
            {reportQuery.error instanceof Error && (reportQuery.error.message.includes('Super administrator access required') || reportQuery.error.message.includes('42501'))
              ? 'Your account does not have super administrator access.'
              : 'Platform data could not be loaded. Confirm the super-admin migration is applied and try again.'}
          </div>
            : report ? <>
              <div className="super-admin-metrics">
                <AdminMetric label="All shops" value={report.summary.total_shops} />
                <AdminMetric label="Active shops" value={report.summary.active_shops} />
                <AdminMetric label="Orders today" value={report.summary.orders_today} />
                <AdminMetric label="Open orders" value={report.summary.open_orders} />
              </div>

              <section className="super-admin-analytics panel">
                <div className="super-admin-analytics-heading"><div><h2>Platform activity</h2><p>Order volume across all shops over the last 7 days</p></div></div>
                {analyticsQuery.isLoading ? <div className="super-admin-chart-state">Loading analytics…</div>
                  : analyticsQuery.isError ? <div className="super-admin-chart-state super-admin-error">Analytics could not be loaded. Confirm the super-admin management migration is applied.</div>
                    : analytics && <>
                      <div className="super-admin-analytics-metrics">
                        <AdminMetric label="Orders this week" value={analytics.summary.orders_7d} />
                        <AdminMetric label="Shops with orders" value={analytics.summary.shops_with_orders_7d} />
                        <AdminMetric label="New shops this week" value={analytics.summary.new_shops_7d} />
                      </div>
                      <div className="super-admin-chart">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={analytics.daily_orders.map((item) => ({ ...item, label: new Date(`${item.day}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }) }))} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                            <CartesianGrid stroke="#edf1ed" vertical={false} />
                            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#89958c', fontSize: 11 }} />
                            <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#89958c', fontSize: 11 }} width={35} />
                            <Tooltip formatter={(value) => [Number(value).toLocaleString('en-IN'), 'Orders']} labelStyle={{ color: '#24352a' }} />
                            <Bar dataKey="orders" fill="#43885a" radius={[5, 5, 0, 0]} maxBarSize={42} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </>}
              </section>

              <section className="super-admin-shops panel">
                <div className="super-admin-list-heading">
                  <div><h2>Shops</h2><p>{report.filtered_shop_count} matching {report.filtered_shop_count === 1 ? 'shop' : 'shops'}</p></div>
                  <label className="super-admin-search"><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search shops" maxLength={100} /></label>
                </div>
                {report.shops.length ? <>
                  <div className="super-admin-table-wrap">
                    <table className="super-admin-table">
                      <thead><tr><th>Shop</th><th>Status</th><th>Team</th><th>Menu</th><th>Orders today</th><th>Open orders</th><th>Last order</th><th>Actions</th></tr></thead>
                      <tbody>{report.shops.map((shop) => (
                        <tr key={shop.id}>
                          <td><div className="super-admin-shop-name"><span><Store size={16} /></span><div><strong>{shop.name}</strong><small>Joined {localDate(shop.created_at)}</small></div></div></td>
                          <td><span className={`super-admin-status ${shop.is_active ? 'super-admin-status-active' : 'super-admin-status-inactive'}`}>{shop.is_active ? 'Active' : 'Inactive'}</span></td>
                          <td>{shop.member_count}</td>
                          <td>{shop.available_products}</td>
                          <td>{shop.orders_today}</td>
                          <td>{shop.open_orders}</td>
                          <td>{localDate(shop.last_order_at, { dateStyle: 'short', timeStyle: 'short' })}</td>
                          <td><button className={`super-admin-shop-action ${shop.is_active ? 'super-admin-shop-action-deactivate' : ''}`} onClick={() => toggleShopStatus(shop)} disabled={shopStatusMutation.isPending}>{shop.is_active ? 'Deactivate' : 'Reactivate'}</button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <div className="super-admin-pagination">
                    <span>Page {page} of {pageCount}</span>
                    <div><button className="button button-secondary" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || reportQuery.isFetching}><ChevronLeft size={15} /> Previous</button><button className="button button-secondary" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount || reportQuery.isFetching}>Next <ChevronRight size={15} /></button></div>
                  </div>
                </> : <div className="super-admin-state">No shops found. Try a different search.</div>}
              </section>
              </> : null}
      </section>
      <footer className="super-admin-footer"><span>Signed in as {user.email}</span><a href="/dashboard"><ArrowLeft size={14} /> Shop workspace</a></footer>
      {createShopOpen && <div className="super-admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateShopOpen(false) }}>
        <section className="super-admin-modal panel" role="dialog" aria-modal="true" aria-labelledby="create-shop-title">
          <div className="super-admin-modal-heading"><div><p className="eyebrow">PLATFORM MANAGEMENT</p><h2 id="create-shop-title">Add a shop</h2></div><button className="icon-button" onClick={() => setCreateShopOpen(false)} aria-label="Close dialog"><X size={18} /></button></div>
          <p className="super-admin-modal-note">This creates a shop workspace and adds your admin account as its initial owner.</p>
          <form className="super-admin-shop-form" onSubmit={(event) => { event.preventDefault(); createShopMutation.mutate(newShop) }}>
            <label>Shop name<input required minLength={2} maxLength={80} value={newShop.name} onChange={(event) => setNewShop((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. The Green Press" /></label>
            <div className="super-admin-form-row">
              <label>Phone<input type="tel" maxLength={40} value={newShop.phone} onChange={(event) => setNewShop((current) => ({ ...current, phone: event.target.value }))} /></label>
              <label>Email<input type="email" maxLength={254} value={newShop.email} onChange={(event) => setNewShop((current) => ({ ...current, email: event.target.value }))} /></label>
            </div>
            <label>Address<input maxLength={300} value={newShop.address} onChange={(event) => setNewShop((current) => ({ ...current, address: event.target.value }))} /></label>
            <div className="super-admin-modal-actions"><button type="button" className="button button-secondary" onClick={() => setCreateShopOpen(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={createShopMutation.isPending}>{createShopMutation.isPending ? 'Creating…' : 'Create shop'} <Plus size={15} /></button></div>
          </form>
        </section>
      </div>}
    </main>
  )
}

function AdminMetric({ label, value }: { label: string; value: number }) {
  return <article className="panel super-admin-metric"><span>{label}</span><strong>{Number(value).toLocaleString('en-IN')}</strong></article>
}
