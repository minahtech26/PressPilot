import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Download, Pencil, Plus, Printer, QrCode, Store, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Shop, ShopRole } from '../lib/types'
import { supabase } from '../lib/supabase'

interface DiningTable {
  id: string
  name: string
  table_number: string
  status: 'available' | 'occupied' | 'order_pending' | 'preparing' | 'bill_pending' | 'payment_completed'
  is_active: boolean
  dueAmount: number
}

const tableStatuses: Record<DiningTable['status'], string> = {
  available: 'Available',
  occupied: 'Occupied',
  order_pending: 'Order pending',
  preparing: 'Preparing',
  bill_pending: 'Bill pending',
  payment_completed: 'Payment completed',
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(value)
  } catch {
    return `${currency} ${Number(value).toFixed(2)}`
  }
}

export function TableManagement({ shop, role }: { shop: Shop; role: ShopRole }) {
  const queryClient = useQueryClient()
  const [tableName, setTableName] = useState('')
  const [tableNumber, setTableNumber] = useState('')
  const [editingTable, setEditingTable] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editNumber, setEditNumber] = useState('')

  const tablesQuery = useQuery({
    queryKey: ['dining-tables', shop.id, role],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const [tablesResult, ordersResult] = await Promise.all([
        supabase.from('dining_tables').select('*').eq('shop_id', shop.id).order('table_number'),
        supabase.from('orders')
          .select('id,table_id,total,order_items(id)')
          .eq('shop_id', shop.id)
          .in('status', ['served', 'completed'])
          .in('payment_status', ['unpaid', 'partial'])
          .not('table_id', 'is', null),
      ])
      if (tablesResult.error) throw tablesResult.error
      if (ordersResult.error) throw ordersResult.error

      let openBills: Array<{
        table_id: string | null
        total: number
        paid_amount: number
        bill_items: Array<{ order_item_id: string | null }>
      }> = []
      if (role !== 'kitchen') {
        const { data, error } = await supabase.from('bills')
          .select('id,table_id,total,paid_amount,bill_items(order_item_id)')
          .eq('shop_id', shop.id)
          .eq('status', 'open')
          .not('table_id', 'is', null)
        if (error) throw error
        openBills = (data ?? []) as typeof openBills
      }
      const unpaidOrders = (ordersResult.data ?? []) as Array<{
        table_id: string | null
        total: number
        order_items: Array<{ id: string }>
      }>
      const billedOrderItemIds = new Set(
        openBills.flatMap((bill) => bill.bill_items.flatMap((item) => item.order_item_id ? [item.order_item_id] : [])),
      )
      const dueByTable = new Map<string, number>()
      function addDue(tableId: string | null, amount: number) {
        if (!tableId || amount <= 0) return
        dueByTable.set(tableId, (dueByTable.get(tableId) ?? 0) + amount)
      }

      if (role !== 'kitchen') {
        for (const bill of openBills) addDue(bill.table_id, Math.max(0, Number(bill.total) - Number(bill.paid_amount)))
        for (const order of unpaidOrders) {
          if (!order.order_items.some((item) => billedOrderItemIds.has(item.id))) addDue(order.table_id, Number(order.total))
        }
      }

      return ((tablesResult.data ?? []) as Omit<DiningTable, 'dueAmount'>[]).map((table) => ({
        ...table,
        dueAmount: dueByTable.get(table.id) ?? 0,
      }))
    },
  })

  useEffect(() => {
    if (!supabase) return
    const channel = supabase
      .channel(`table-balances:${shop.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `shop_id=eq.${shop.id}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['dining-tables', shop.id] })
      })
    if (role !== 'kitchen') {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: 'bills', filter: `shop_id=eq.${shop.id}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['dining-tables', shop.id] })
      })
    }
    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        toast.error('Live table billing updates disconnected. Check your connection.')
      }
    })

    return () => {
      void supabase?.removeChannel(channel)
    }
  }, [queryClient, role, shop.id])

  const addTable = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const name = tableName.trim()
      const number = tableNumber.trim()
      if (name.length < 1 || name.length > 60 || number.length < 1 || number.length > 30) {
        throw new Error('Enter a table name and a number (up to 60 and 30 characters).')
      }
      const { error } = await supabase.from('dining_tables').insert({ shop_id: shop.id, name, table_number: number })
      if (error) throw error
    },
    onSuccess: async () => {
      setTableName('')
      setTableNumber('')
      await queryClient.invalidateQueries({ queryKey: ['dining-tables', shop.id] })
      toast.success('Table added')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not add table.'),
  })

  const updateTable = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<DiningTable, 'name' | 'table_number' | 'is_active'>> }) => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { error } = await supabase.from('dining_tables').update(patch).eq('id', id).eq('shop_id', shop.id)
      if (error) throw error
    },
    onSuccess: async () => {
      setEditingTable(null)
      await queryClient.invalidateQueries({ queryKey: ['dining-tables', shop.id] })
      toast.success('Table updated')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not update table.'),
  })

  const deleteTable = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { error } = await supabase.from('dining_tables').delete().eq('id', id).eq('shop_id', shop.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dining-tables', shop.id] })
      toast.success('Inactive table removed')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not remove table.'),
  })

  const activeTables = (tablesQuery.data ?? []).filter((table) => table.is_active)

  function menuUrl(table: DiningTable) {
    const appUrl = import.meta.env.VITE_APP_URL?.trim().replace(/\/+$/, '') || window.location.origin
    return `${appUrl}/menu/${encodeURIComponent(shop.slug)}?table=${encodeURIComponent(table.id)}`
  }

  function downloadQr(table: DiningTable) {
    const qr = document.querySelector<SVGElement>(`[data-qr-id="${table.id}"] svg`)
    if (!qr) {
      toast.error('QR code is not ready to download.')
      return
    }
    const svg = qr.cloneNode(true) as SVGElement
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `${shop.slug}-table-${table.table_number}.svg`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  }

  function printAllQrs() {
    if (!activeTables.length) {
      toast.info('Add an active table before printing QR codes.')
      return
    }
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      toast.error('Allow pop-ups to print table QR codes.')
      return
    }
    printWindow.opener = null
    const cards = activeTables.map((table) => {
      const svg = document.querySelector<SVGElement>(`[data-qr-id="${table.id}"] svg`)?.outerHTML ?? ''
      return `<article><div class="qr">${svg}</div><h2>${escapeHtml(table.name)}</h2><p>Table ${escapeHtml(table.table_number)}</p></article>`
    }).join('')
    printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(shop.name)} table QR codes</title><style>
      *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#17261f;margin:24px}
      h1{font-size:22px;margin:0 0 4px}header{margin-bottom:20px}header p{margin:0;color:#6b756d;font-size:12px}
      main{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
      article{border:1px solid #dfe6df;border-radius:10px;padding:14px;text-align:center;break-inside:avoid}
      .qr svg{width:150px;height:150px}h2{font-size:15px;margin:8px 0 3px}article p{font-size:11px;color:#68756b;margin:0}
      @media print{body{margin:12mm}@page{margin:10mm}}
    </style></head><body><header><h1>${escapeHtml(shop.name)}</h1><p>Scan to browse the menu and order from your table</p></header><main>${cards}</main><script>window.onload=()=>window.print()</script></body></html>`)
    printWindow.document.close()
  }

  return (
    <section className="page-content tables-content">
      <div className="welcome-row">
        <div className="page-heading">
          <p className="eyebrow">YOUR DINING ROOM</p>
          <h1>Tables & QR codes</h1>
          <p>Every active table gets its own QR link to your public menu.</p>
        </div>
        <button className="button button-secondary" onClick={printAllQrs}><Printer size={16} /> Print all QR codes</button>
      </div>
      <div className="table-create-card panel">
        <div className="settings-icon"><Plus size={18} /></div>
        <div className="table-create-copy"><strong>Add a table</strong><span>Give it a name and a table number to create its unique menu QR code.</span></div>
        <form className="table-create-form" onSubmit={(event) => { event.preventDefault(); addTable.mutate() }}>
          <input value={tableName} onChange={(event) => setTableName(event.target.value)} placeholder="Table name (e.g. Window seat)" maxLength={60} required />
          <input value={tableNumber} onChange={(event) => setTableNumber(event.target.value)} placeholder="Number (e.g. 01)" maxLength={30} required />
          <button type="submit" className="button button-primary" disabled={addTable.isPending}>{addTable.isPending ? 'Adding…' : 'Add table'} <Plus size={15} /></button>
        </form>
      </div>
      <div className="table-summary">
        <div><span className="summary-dot summary-available" /><strong>{activeTables.length}</strong><span>Active tables</span></div>
        <span className="summary-divider" />
        <div><span className="summary-dot summary-busy" /><strong>{activeTables.filter((table) => table.status !== 'available' && table.status !== 'payment_completed').length}</strong><span>In use</span></div>
      </div>
      {tablesQuery.isLoading ? <div className="panel tables-empty">Loading tables…</div> : tablesQuery.isError ? <div className="panel tables-empty">Tables could not be loaded. Check your connection and try again.</div> : (tablesQuery.data ?? []).length ? (
        <div className="table-qr-grid">
          {(tablesQuery.data ?? []).map((table) => (
            <article className={`panel table-qr-card ${!table.is_active ? 'table-inactive' : ''}`} key={table.id}>
              <div className="table-card-top">
                <div className="table-card-icon"><Store size={17} /></div>
                <span className={`table-status status-${table.status}`}>{table.is_active ? tableStatuses[table.status] : 'Inactive'}</span>
                <div className="table-card-actions">
                  <button className="icon-button" aria-label="Edit table" onClick={() => {
                    setEditingTable(table.id)
                    setEditName(table.name)
                    setEditNumber(table.table_number)
                  }}><Pencil size={14} /></button>
                  {table.is_active
                    ? <button className="icon-button danger-icon" aria-label="Deactivate table" onClick={() => {
                      if (window.confirm(`Deactivate Table ${table.table_number}? Its QR code will stop accepting orders.`)) {
                        updateTable.mutate({ id: table.id, patch: { is_active: false } })
                      }
                    }}><X size={15} /></button>
                    : <>
                      <button className="icon-button" aria-label="Reactivate table" onClick={() => updateTable.mutate({ id: table.id, patch: { is_active: true } })}><Check size={15} /></button>
                      <button className="icon-button danger-icon" aria-label="Delete inactive table" onClick={() => {
                        if (window.confirm(`Permanently remove inactive Table ${table.table_number}?`)) deleteTable.mutate(table.id)
                      }}><Trash2 size={15} /></button>
                    </>}
                </div>
              </div>
              {editingTable === table.id ? (
                <form className="table-edit-form" onSubmit={(event) => {
                  event.preventDefault()
                  updateTable.mutate({ id: table.id, patch: { name: editName.trim(), table_number: editNumber.trim() } })
                }}>
                  <input value={editName} onChange={(event) => setEditName(event.target.value)} aria-label="Table name" maxLength={60} required />
                  <input value={editNumber} onChange={(event) => setEditNumber(event.target.value)} aria-label="Table number" maxLength={30} required />
                  <div><button type="button" className="button button-secondary button-small" onClick={() => setEditingTable(null)}>Cancel</button><button type="submit" className="button button-primary button-small" disabled={updateTable.isPending}><Check size={13} /> Save</button></div>
                </form>
              ) : (
                <div className="table-title"><h2>{table.name}</h2><span>Table {table.table_number}</span></div>
              )}
              {table.dueAmount > 0 && <div className="table-balance-alert"><span>Amount to settle</span><strong>{money(table.dueAmount, shop.currency)}</strong></div>}
              <div className="qr-card-code" data-qr-id={table.id}>
                {table.is_active ? <QRCodeSVG value={menuUrl(table)} size={142} level="M" includeMargin /> : <div className="qr-inactive"><QrCode size={28} /><span>QR paused</span></div>}
              </div>
              <div className="qr-card-footer">
                <span>{table.is_active ? 'Scan to order at this table' : 'This QR no longer accepts orders'}</span>
                {table.is_active && <button className="quiet-link" onClick={() => downloadQr(table)}><Download size={14} /> Download</button>}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel tables-empty"><div className="empty-art"><QrCode size={24} /></div><strong>No tables yet</strong><span>Add your first table above. A printable QR code will be generated automatically.</span></div>
      )}
    </section>
  )
}
