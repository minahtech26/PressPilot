import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronLeft, ChevronRight, LogOut, RefreshCw, Search, ShieldCheck, Store } from 'lucide-react'
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

function localDate(value: string | null, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) {
  if (!value) return 'No orders yet'
  return new Date(value).toLocaleString('en-IN', options)
}

export function SuperAdminDashboard({ user }: { user: User }) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
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

  const report = reportQuery.data
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

  return (
    <main className="super-admin-page">
      <header className="super-admin-topbar">
        <a className="super-admin-brand" href="/admin"><span><ShieldCheck size={19} /></span><strong>Freshdesk</strong><small>Platform admin</small></a>
        <div className="super-admin-account"><span title={user.email ?? undefined}>{user.email}</span><button className="button button-secondary" onClick={signOut}><LogOut size={15} /> Sign out</button></div>
      </header>
      <section className="super-admin-content">
        <div className="super-admin-heading">
          <div><p className="eyebrow">PLATFORM OVERVIEW</p><h1>Shop monitoring</h1><p>Monitor shop activity across the platform. Customer and staff personal information isn’t shown here.</p></div>
          <button className="super-admin-live" onClick={() => void reportQuery.refetch()} disabled={reportQuery.isFetching}><RefreshCw size={14} /> {reportQuery.isFetching ? 'Refreshing…' : 'Refresh data'}</button>
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

              <section className="super-admin-shops panel">
                <div className="super-admin-list-heading">
                  <div><h2>Shops</h2><p>{report.filtered_shop_count} matching {report.filtered_shop_count === 1 ? 'shop' : 'shops'}</p></div>
                  <label className="super-admin-search"><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search shops" maxLength={100} /></label>
                </div>
                {report.shops.length ? <>
                  <div className="super-admin-table-wrap">
                    <table className="super-admin-table">
                      <thead><tr><th>Shop</th><th>Status</th><th>Team</th><th>Menu</th><th>Orders today</th><th>Open orders</th><th>Last order</th></tr></thead>
                      <tbody>{report.shops.map((shop) => (
                        <tr key={shop.id}>
                          <td><div className="super-admin-shop-name"><span><Store size={16} /></span><div><strong>{shop.name}</strong><small>Joined {localDate(shop.created_at)}</small></div></div></td>
                          <td><span className={`super-admin-status ${shop.is_active ? 'super-admin-status-active' : 'super-admin-status-inactive'}`}>{shop.is_active ? 'Active' : 'Inactive'}</span></td>
                          <td>{shop.member_count}</td>
                          <td>{shop.available_products}</td>
                          <td>{shop.orders_today}</td>
                          <td>{shop.open_orders}</td>
                          <td>{localDate(shop.last_order_at, { dateStyle: 'short', timeStyle: 'short' })}</td>
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
    </main>
  )
}

function AdminMetric({ label, value }: { label: string; value: number }) {
  return <article className="panel super-admin-metric"><span>{label}</span><strong>{Number(value).toLocaleString('en-IN')}</strong></article>
}
