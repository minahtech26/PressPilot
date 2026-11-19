import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CalendarDays, Download, FileText, Package, ShoppingBasket, TrendingUp } from 'lucide-react'
import type { Shop } from '../lib/types'
import { supabase } from '../lib/supabase'

type ReportRange = 7 | 30 | 90

interface ReportData {
  summary: {
    order_count: number
    cancelled_count: number
    gross_order_value: number
    average_order_value: number
  }
  daily: Array<{
    date: string
    orders: number
    order_value: number
  }>
  top_products: Array<{
    product_name: string
    quantity: number
    item_value: number
  }>
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`
}

function reportBounds(days: ReportRange) {
  const end = new Date()
  end.setUTCHours(24, 0, 0, 0)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - days)
  return { start: start.toISOString(), end: end.toISOString() }
}

function displayDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', options)
}

export function ReportingManagement({ shop }: { shop: Shop }) {
  const [range, setRange] = useState<ReportRange>(7)
  const bounds = useMemo(() => reportBounds(range), [range])
  const reportQuery = useQuery({
    queryKey: ['shop-report', shop.id, range],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { data, error } = await supabase.rpc('get_shop_report', {
        target_shop_id: shop.id,
        start_at: bounds.start,
        end_at: bounds.end,
      })
      if (error) throw error
      if (!data || typeof data !== 'object') throw new Error('The report returned an invalid response.')
      return data as ReportData
    },
  })

  const report = reportQuery.data
  const chartData = useMemo(() => report?.daily.map((day) => ({
    ...day,
    label: displayDate(day.date, range === 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' }),
    order_value: Number(day.order_value),
  })) ?? [], [report, range])

  function downloadCsv() {
    if (!report) return
    const rows = [
      ['Daily order report', shop.name],
      ['Date range', `${range} days`],
      [],
      ['Daily breakdown'],
      ['Date', 'Orders', 'Order value'],
      ...report.daily.map((day) => [day.date, day.orders, day.order_value]),
      [],
      ['Top products'],
      ['Product', 'Quantity', 'Item value'],
      ...report.top_products.map((product) => [product.product_name, product.quantity, product.item_value]),
    ]
    const csv = rows.map((row) => row.map((cell) => csvCell(cell ?? '')).join(',')).join('\r\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${shop.slug}-report-${range}-days.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="page-content reports-content">
      <div className="welcome-row">
        <div className="page-heading">
          <p className="eyebrow">BUSINESS PERFORMANCE</p>
          <h1>Reports</h1>
          <p>Track order value, order volume, and your best-selling items.</p>
        </div>
        <div className="report-actions">
          <label className="report-range">
            <CalendarDays size={15} />
            <span className="sr-only">Report period</span>
            <select value={range} onChange={(event) => setRange(Number(event.target.value) as ReportRange)}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
          <button className="button button-secondary" onClick={downloadCsv} disabled={!report || reportQuery.isError}>
            <Download size={15} /> Export CSV
          </button>
        </div>
      </div>

      {reportQuery.isLoading ? <div className="panel reports-empty">Loading reports…</div>
        : reportQuery.isError ? <div className="panel reports-empty reports-error">Reports could not be loaded. Confirm the latest Supabase migration is applied and try again.</div>
          : report ? <>
            <div className="report-metrics">
              <ReportMetric icon={ShoppingBasket} label="Orders placed" value={report.summary.order_count.toLocaleString('en-IN')} note={`${range}-day period`} />
              <ReportMetric icon={TrendingUp} label="Order value" value={money(Number(report.summary.gross_order_value), shop.currency)} note="Excludes cancelled orders" />
              <ReportMetric icon={FileText} label="Average order" value={money(Number(report.summary.average_order_value), shop.currency)} note="Per non-cancelled order" />
              <ReportMetric icon={Package} label="Cancelled" value={report.summary.cancelled_count.toLocaleString('en-IN')} note="Orders cancelled in period" />
            </div>

            <div className="report-grid">
              <section className="panel report-chart-panel">
                <div className="report-panel-heading"><div><h2>Order value over time</h2><p>Gross order value by day, excluding cancellations</p></div></div>
                {report.summary.order_count === 0 ? <div className="reports-empty report-chart-empty">No orders in this period yet.</div> : (
                  <div className="report-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="#edf1ed" vertical={false} />
                        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#89958c', fontSize: 11 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#89958c', fontSize: 11 }} width={65} tickFormatter={(value: number) => new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(value)} />
                        <Tooltip formatter={(value) => [money(Number(value), shop.currency), 'Order value']} labelStyle={{ color: '#24352a' }} />
                        <Bar dataKey="order_value" fill="#5685f5" radius={[5, 5, 0, 0]} maxBarSize={38} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>

              <section className="panel report-products-panel">
                <div className="report-panel-heading"><div><h2>Top products</h2><p>Ranked by quantity ordered</p></div></div>
                {report.top_products.length ? <div className="report-product-list">
                  {report.top_products.map((product, index) => (
                    <div className="report-product-row" key={product.product_name}>
                      <span className="report-product-rank">{String(index + 1).padStart(2, '0')}</span>
                      <div className="report-product-copy"><strong>{product.product_name}</strong><span>{Number(product.quantity).toLocaleString('en-IN')} ordered</span></div>
                      <strong className="report-product-value">{money(Number(product.item_value), shop.currency)}</strong>
                    </div>
                  ))}
                </div> : <div className="reports-empty report-products-empty">Product sales will appear once orders come in.</div>}
              </section>
            </div>
            <p className="report-footnote">Order value is calculated from placed orders, not payment settlement. Cancelled orders are excluded from value and product totals.</p>
          </> : null}
    </section>
  )
}

function ReportMetric({ icon: Icon, label, value, note }: { icon: typeof ShoppingBasket; label: string; value: string; note: string }) {
  return (
    <article className="panel report-metric">
      <span className="report-metric-icon"><Icon size={17} /></span>
      <span className="report-metric-label">{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  )
}
