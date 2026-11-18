import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, Check, ChevronRight, CreditCard, FileText, Printer, ReceiptText, Smartphone, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Shop } from '../lib/types'
import { supabase } from '../lib/supabase'
import { firstRelation, orderSelect, type ShopOrder } from '../lib/orders'

type PaymentMethod = 'cash' | 'upi' | 'card' | 'other'

interface BillItem {
  id: string
  order_item_id: string | null
  product_name: string
  quantity: number
  unit_price: number
  discount: number
  tax: number
  line_total: number
}

interface BillPayment {
  id: string
  method: PaymentMethod
  amount: number
  reference: string | null
  created_at: string
}

interface ShopBill {
  id: string
  shop_id: string
  table_id: string | null
  invoice_number: string | null
  status: 'open' | 'settled' | 'void'
  subtotal: number
  discount: number
  tax: number
  service_charge: number
  total: number
  paid_amount: number
  settled_at: string | null
  created_at: string
  dining_tables: { name: string; table_number: string } | { name: string; table_number: string }[] | null
  bill_items: BillItem[]
  payments: BillPayment[]
}

interface BillGroup {
  id: string
  label: string
  orders: ShopOrder[]
  amount: number
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(value)
  } catch {
    return `${currency} ${Number(value).toFixed(2)}`
  }
}

function outstanding(bill: ShopBill) {
  return Math.max(0, Number(bill.total) - Number(bill.paid_amount))
}

function paymentIcon(method: PaymentMethod) {
  if (method === 'cash') return Banknote
  if (method === 'upi') return Smartphone
  if (method === 'card') return CreditCard
  return ReceiptText
}

export function BillingManagement({ shop, currency }: { shop: Shop; currency: string }) {
  const queryClient = useQueryClient()
  const [billFilter, setBillFilter] = useState<'open' | 'settled'>('open')
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null)
  const [paymentBillId, setPaymentBillId] = useState<string | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [paymentReference, setPaymentReference] = useState('')

  useEffect(() => {
    if (!supabase) return
    const channel = supabase
      .channel(`live-billing:${shop.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bills',
        filter: `shop_id=eq.${shop.id}`,
      }, () => {
        void queryClient.invalidateQueries({ queryKey: ['bills', shop.id] })
        void queryClient.invalidateQueries({ queryKey: ['billing-orders', shop.id] })
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'payments',
        filter: `shop_id=eq.${shop.id}`,
      }, () => {
        void queryClient.invalidateQueries({ queryKey: ['bills', shop.id] })
        void queryClient.invalidateQueries({ queryKey: ['notifications', shop.id] })
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          toast.error('Live billing updates disconnected. Check your connection.')
        }
      })

    return () => {
      void supabase?.removeChannel(channel)
    }
  }, [queryClient, shop.id])

  const ordersQuery = useQuery({
    queryKey: ['billing-orders', shop.id],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('orders')
        .select(orderSelect)
        .eq('shop_id', shop.id)
        .in('status', ['served', 'completed'])
        .in('payment_status', ['unpaid', 'partial'])
        .order('created_at', { ascending: true })
        .limit(200)
      if (error) throw error
      return (data ?? []) as unknown as ShopOrder[]
    },
  })

  const billsQuery = useQuery({
    queryKey: ['bills', shop.id],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('bills')
        .select('*, dining_tables(name,table_number), bill_items(id,order_item_id,product_name,quantity,unit_price,discount,tax,line_total), payments(id,method,amount,reference,created_at)')
        .eq('shop_id', shop.id)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data ?? []) as unknown as ShopBill[]
    },
  })

  const createBill = useMutation({
    mutationFn: async (orders: ShopOrder[]) => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { data, error } = await supabase.rpc('create_bill_for_orders', {
        target_shop_id: shop.id,
        target_order_ids: orders.map((order) => order.id),
        bill_discount: 0,
      })
      if (error) throw error
      return data
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bills', shop.id] }),
        queryClient.invalidateQueries({ queryKey: ['billing-orders', shop.id] }),
        queryClient.invalidateQueries({ queryKey: ['orders', shop.id] }),
        queryClient.invalidateQueries({ queryKey: ['dining-tables', shop.id] }),
      ])
      toast.success('Invoice created with current order prices and shop service charge.')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Bill could not be created.'),
  })

  const recordPayment = useMutation({
    mutationFn: async ({ billId, amount, method, reference }: { billId: string; amount: number; method: PaymentMethod; reference: string }) => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { error } = await supabase.rpc('record_bill_payment', {
        target_shop_id: shop.id,
        target_bill_id: billId,
        payment_method: method,
        payment_amount: amount,
        payment_reference: reference.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bills', shop.id] }),
        queryClient.invalidateQueries({ queryKey: ['billing-orders', shop.id] }),
        queryClient.invalidateQueries({ queryKey: ['orders', shop.id] }),
        queryClient.invalidateQueries({ queryKey: ['dining-tables', shop.id] }),
        queryClient.invalidateQueries({ queryKey: ['notifications', shop.id] }),
      ])
      setPaymentBillId(null)
      setPaymentAmount('')
      setPaymentReference('')
      toast.success('Payment recorded.')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Payment could not be recorded.'),
  })

  const bills = billsQuery.data ?? []
  const linkedOrderItemIds = useMemo(() => new Set(
    bills
      .filter((bill) => bill.status !== 'void')
      .flatMap((bill) => bill.bill_items.map((item) => item.order_item_id).filter((id): id is string => Boolean(id))),
  ), [bills])
  const groups = useMemo(() => {
    const grouped = new Map<string, BillGroup>()
    for (const order of ordersQuery.data ?? []) {
      if (order.order_items.length === 0 || order.order_items.some((item) => linkedOrderItemIds.has(item.id))) continue
      const table = firstRelation(order.dining_tables)
      const key = order.table_id ?? `pickup:${order.id}`
      const current = grouped.get(key) ?? {
        id: key,
        label: table ? `${table.name} · Table ${table.table_number}` : `Pickup order #${order.order_number}`,
        orders: [],
        amount: 0,
      }
      current.orders.push(order)
      current.amount += Number(order.total)
      grouped.set(key, current)
    }
    return [...grouped.values()]
  }, [linkedOrderItemIds, ordersQuery.data])

  const visibleBills = bills.filter((bill) => billFilter === 'open' ? bill.status === 'open' : bill.status === 'settled')
  const openCount = bills.filter((bill) => bill.status === 'open').length
  const outstandingTotal = bills.filter((bill) => bill.status === 'open').reduce((total, bill) => total + outstanding(bill), 0)
  const settledTotal = bills.filter((bill) => bill.status === 'settled').reduce((total, bill) => total + Number(bill.total), 0)
  const selectedBill = bills.find((bill) => bill.id === selectedBillId) ?? null
  const paymentBill = bills.find((bill) => bill.id === paymentBillId) ?? null

  function openPayment(bill: ShopBill) {
    setPaymentBillId(bill.id)
    setPaymentAmount(outstanding(bill).toFixed(2))
    setPaymentMethod('cash')
    setPaymentReference('')
  }

  const paymentValue = Number(paymentAmount)
  const paymentIsValid = Number.isFinite(paymentValue)
    && paymentValue > 0
    && paymentValue <= (paymentBill ? outstanding(paymentBill) : 0)
    && Math.abs(paymentValue - Math.round(paymentValue * 100) / 100) < 1e-8

  return (
    <section className="page-content billing-content">
      <div className="welcome-row">
        <div className="page-heading"><p className="eyebrow">PAYMENTS & RECEIPTS</p><h1>Billing</h1><p>Create invoices for served orders, record payments, and close paid tables.</p></div>
        <span className="realtime-pill"><span className="live-dot" /> Shop-scoped billing</span>
      </div>
      <div className="billing-metrics">
        <div className="billing-metric"><span className="billing-metric-icon billing-metric-open"><ReceiptText size={17} /></span><span>Open invoices</span><strong>{openCount}</strong></div>
        <div className="billing-metric"><span className="billing-metric-icon billing-metric-due"><Banknote size={17} /></span><span>Amount due</span><strong>{money(outstandingTotal, currency)}</strong></div>
        <div className="billing-metric"><span className="billing-metric-icon billing-metric-paid"><Check size={17} /></span><span>Settled invoices</span><strong>{money(settledTotal, currency)}</strong></div>
      </div>

      <section className="billable-section">
        <div className="billing-section-heading"><div><h2>Ready to bill</h2><p>Served orders without an active invoice</p></div><span className="billing-count">{groups.reduce((total, group) => total + group.orders.length, 0)} orders</span></div>
        {ordersQuery.isLoading || billsQuery.isLoading ? <div className="panel billing-empty">Loading billable orders…</div> : ordersQuery.isError || billsQuery.isError ? <div className="panel billing-empty billing-error">Billing data could not be loaded. Check your connection and permissions.</div> : groups.length ? (
          <div className="billable-grid">
            {groups.map((group) => (
              <article className="billable-card" key={group.id}>
                <div className="billable-card-head"><span className="billable-location"><ReceiptText size={15} />{group.label}</span><div className="billable-estimate"><small>Order total</small><strong>{money(group.amount, currency)}</strong></div></div>
                <div className="billable-order-list">{group.orders.map((order) => (
                  <div className="billable-order" key={order.id}><span>Order #{order.order_number}</span><span>{order.order_items.reduce((total, item) => total + item.quantity, 0)} items · {new Date(order.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span><strong>{money(Number(order.total), currency)}</strong></div>
                ))}</div>
                <button className="button button-primary billable-create" disabled={createBill.isPending} onClick={() => createBill.mutate(group.orders)}>{createBill.isPending ? 'Creating invoice…' : group.orders.length > 1 ? `Create combined invoice · ${group.orders.length} orders` : 'Create invoice'} <ChevronRight size={15} /></button>
              </article>
            ))}
          </div>
        ) : <div className="panel billing-empty"><div className="empty-art"><Check size={22} /></div><strong>No orders waiting for a bill</strong><span>Served orders without an invoice will appear here.</span></div>}
      </section>

      <section className="billing-list-section">
        <div className="billing-section-heading"><div><h2>Invoices</h2><p>Payment history and outstanding balances</p></div><div className="billing-filters"><button className={billFilter === 'open' ? 'billing-filter active' : 'billing-filter'} onClick={() => setBillFilter('open')}>Open <span>{openCount}</span></button><button className={billFilter === 'settled' ? 'billing-filter active' : 'billing-filter'} onClick={() => setBillFilter('settled')}>Settled <span>{bills.filter((bill) => bill.status === 'settled').length}</span></button></div></div>
        <div className="panel invoice-panel">
          {billsQuery.isLoading ? <div className="billing-empty">Loading invoices…</div> : billsQuery.isError ? <div className="billing-empty billing-error">Invoices could not be loaded.</div> : visibleBills.length ? <div className="invoice-list">
            {visibleBills.map((bill) => {
              const table = firstRelation(bill.dining_tables)
              const due = outstanding(bill)
              return <article className="invoice-row" key={bill.id}>
                <div className="invoice-symbol"><FileText size={17} /></div>
                <div className="invoice-main"><strong>{bill.invoice_number || 'Invoice'}</strong><span>{table ? `${table.name} · Table ${table.table_number}` : 'Pickup order'} · {new Date(bill.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</span><small>{bill.bill_items.length} line items · {bill.payments.length} payment{bill.payments.length === 1 ? '' : 's'}</small></div>
                <div className="invoice-values"><strong>{money(Number(bill.total), currency)}</strong>{bill.status === 'open' ? <span className="invoice-due">Due {money(due, currency)}</span> : <span className="invoice-paid">Paid in full</span>}</div>
                <div className="invoice-actions"><button className="button button-secondary button-small" onClick={() => setSelectedBillId(bill.id)}>Details</button>{bill.status === 'open' && <button className="button button-primary button-small" onClick={() => openPayment(bill)}>Record payment</button>}</div>
              </article>
            })}
          </div> : <div className="billing-empty"><div className="empty-art"><ReceiptText size={22} /></div><strong>{billFilter === 'open' ? 'No open invoices' : 'No settled invoices yet'}</strong><span>{billFilter === 'open' ? 'Create an invoice from a served order to get started.' : 'Settled invoices will appear here.'}</span></div>}
        </div>
      </section>

      {selectedBill && <BillDetails bill={selectedBill} shopName={shop.name} currency={currency} onClose={() => setSelectedBillId(null)} onPayment={() => openPayment(selectedBill)} />}
      {paymentBill && <PaymentDialog bill={paymentBill} currency={currency} amount={paymentAmount} method={paymentMethod} reference={paymentReference} pending={recordPayment.isPending} valid={paymentIsValid} onAmount={setPaymentAmount} onMethod={setPaymentMethod} onReference={setPaymentReference} onClose={() => setPaymentBillId(null)} onSubmit={() => {
        if (paymentIsValid) recordPayment.mutate({ billId: paymentBill.id, amount: paymentValue, method: paymentMethod, reference: paymentReference })
      }} />}
    </section>
  )
}

function BillDetails({ bill, shopName, currency, onClose, onPayment }: { bill: ShopBill; shopName: string; currency: string; onClose: () => void; onPayment: () => void }) {
  const table = firstRelation(bill.dining_tables)
  return (
    <div className="checkout-overlay order-dialog-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="checkout-modal bill-detail-modal" role="dialog" aria-modal="true" aria-labelledby="bill-detail-heading">
        <div className="checkout-head no-print"><div><p className="eyebrow">CUSTOMER RECEIPT</p><h2 id="bill-detail-heading">{bill.invoice_number || 'Invoice'}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close invoice"><X size={19} /></button></div>
        <div className="receipt-heading"><strong>{shopName} · {table ? `${table.name} · Table ${table.table_number}` : 'Pickup order'}</strong><span>{new Date(bill.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
        <div className="receipt-lines"><div className="receipt-line receipt-line-heading"><span>Item</span><span>Qty</span><span>Amount</span></div>{bill.bill_items.map((item) => <div className="receipt-line" key={item.id}><span>{item.product_name}</span><span>{item.quantity}</span><span>{money(Number(item.unit_price) * item.quantity - Number(item.discount), currency)}</span></div>)}</div>
        <div className="receipt-totals"><span>Subtotal <strong>{money(Number(bill.subtotal), currency)}</strong></span>{Number(bill.discount) > 0 && <span>Discount <strong>−{money(Number(bill.discount), currency)}</strong></span>}<span>Tax <strong>{money(Number(bill.tax), currency)}</strong></span>{Number(bill.service_charge) > 0 && <span>Service charge <strong>{money(Number(bill.service_charge), currency)}</strong></span>}<span className="receipt-grand-total">Total <strong>{money(Number(bill.total), currency)}</strong></span><span>Paid <strong>{money(Number(bill.paid_amount), currency)}</strong></span><span>Balance due <strong>{money(outstanding(bill), currency)}</strong></span></div>
        {bill.payments.length > 0 && <div className="receipt-payments"><strong>Payments</strong>{bill.payments.map((payment) => {
          const Icon = paymentIcon(payment.method)
          return <div key={payment.id}><Icon size={13} /><span>{payment.method.toUpperCase()}{payment.reference ? ` · ${payment.reference}` : ''}</span><strong>{money(Number(payment.amount), currency)}</strong></div>
        })}</div>}
        <div className="bill-detail-actions no-print"><button className="button button-secondary" onClick={() => window.print()}><Printer size={15} /> Print receipt</button>{bill.status === 'open' && <button className="button button-primary" onClick={onPayment}>Record payment <ChevronRight size={15} /></button>}</div>
      </section>
    </div>
  )
}

function PaymentDialog({ bill, currency, amount, method, reference, pending, valid, onAmount, onMethod, onReference, onClose, onSubmit }: {
  bill: ShopBill
  currency: string
  amount: string
  method: PaymentMethod
  reference: string
  pending: boolean
  valid: boolean
  onAmount: (value: string) => void
  onMethod: (value: PaymentMethod) => void
  onReference: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const due = outstanding(bill)
  return (
    <div className="checkout-overlay order-dialog-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="checkout-modal payment-dialog" role="dialog" aria-modal="true" aria-labelledby="record-payment-heading">
        <div className="checkout-head"><div><p className="eyebrow">{bill.invoice_number || 'INVOICE'}</p><h2 id="record-payment-heading">Record payment</h2></div><button className="icon-button" onClick={onClose} aria-label="Close payment dialog"><X size={19} /></button></div>
        <div className="payment-balance"><span>Outstanding balance</span><strong>{money(due, currency)}</strong></div>
        <label className="form-field"><span>Payment amount</span><input type="number" min="0.01" max={due} step="0.01" value={amount} onChange={(event) => onAmount(event.target.value)} /></label>
        <label className="form-field"><span>Payment method</span><select value={method} onChange={(event) => onMethod(event.target.value as PaymentMethod)}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="other">Other</option></select></label>
        <label className="form-field"><span>Reference <small className="optional-label">Optional</small></span><input value={reference} onChange={(event) => onReference(event.target.value)} maxLength={120} placeholder="Transaction or receipt reference" /></label>
        <div className="payment-dialog-actions"><button className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={pending || !valid} onClick={onSubmit}>{pending ? 'Recording…' : 'Record payment'} <Check size={15} /></button></div>
      </section>
    </div>
  )
}
