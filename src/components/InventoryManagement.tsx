import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Box, ClipboardList, Edit3, Factory, Minus, PackagePlus, Plus, Search, Settings2, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Shop, ShopRole } from '../lib/types'
import { supabase } from '../lib/supabase'

interface InventoryItem {
  id: string
  name: string
  unit: string
  quantity: number
  low_stock_threshold: number
  updated_at: string
}

interface Supplier {
  id: string
  name: string
  phone: string | null
  email: string | null
}

interface RecipeRow {
  product_id: string
  inventory_item_id: string
  quantity: number
  inventory_items: { id: string; name: string; unit: string } | { id: string; name: string; unit: string }[] | null
}

interface StockMovement {
  id: string
  inventory_item_id: string
  quantity_delta: number
  reason: string
  reference_id: string | null
  created_at: string
  inventory_items: { name: string; unit: string } | { name: string; unit: string }[] | null
}

interface ProductOption {
  id: string
  name: string
  is_available: boolean
}

type InventoryTab = 'stock' | 'recipes' | 'suppliers' | 'history'

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function amount(value: number, precision = 3) {
  return Number(value).toLocaleString('en-IN', { maximumFractionDigits: precision })
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function InventoryManagement({ shop, role }: { shop: Shop; role: ShopRole }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<InventoryTab>('stock')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<'create' | 'edit' | 'purchase' | 'adjust' | 'supplier' | null>(null)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [recipeProduct, setRecipeProduct] = useState<ProductOption | null>(null)
  const isManager = role === 'owner' || role === 'manager'

  const itemsQuery = useQuery({
    queryKey: ['inventory-items', shop.id],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('inventory_items')
        .select('id,name,unit,quantity,low_stock_threshold,updated_at')
        .eq('shop_id', shop.id)
        .order('name', { ascending: true })
      if (error) throw error
      return (data ?? []) as InventoryItem[]
    },
  })
  const settingsQuery = useQuery({
    queryKey: ['inventory-settings', shop.id],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('shop_settings')
        .select('inventory_enabled,allow_negative_stock')
        .eq('shop_id', shop.id)
        .single()
      if (error) throw error
      return data
    },
  })
  const inventoryEnabled = settingsQuery.data?.inventory_enabled ?? false
  const allowNegativeStock = settingsQuery.data?.allow_negative_stock ?? false
  const productsQuery = useQuery({
    queryKey: ['inventory-products', shop.id],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('products')
        .select('id,name,is_available')
        .eq('shop_id', shop.id)
        .order('name', { ascending: true })
      if (error) throw error
      return (data ?? []) as ProductOption[]
    },
  })
  const suppliersQuery = useQuery({
    queryKey: ['inventory-suppliers', shop.id],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('suppliers')
        .select('id,name,phone,email')
        .eq('shop_id', shop.id)
        .order('name', { ascending: true })
      if (error) throw error
      return (data ?? []) as Supplier[]
    },
  })
  const recipesQuery = useQuery({
    queryKey: ['product-recipes', shop.id],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('product_ingredients')
        .select('product_id,inventory_item_id,quantity,inventory_items(id,name,unit)')
        .eq('shop_id', shop.id)
      if (error) throw error
      return (data ?? []) as unknown as RecipeRow[]
    },
  })
  const movementsQuery = useQuery({
    queryKey: ['stock-movements', shop.id],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('stock_movements')
        .select('id,inventory_item_id,quantity_delta,reason,reference_id,created_at,inventory_items(name,unit)')
        .eq('shop_id', shop.id)
        .order('created_at', { ascending: false })
        .limit(150)
      if (error) throw error
      return (data ?? []) as unknown as StockMovement[]
    },
  })

  useEffect(() => {
    if (!supabase) return
    const channel = supabase
      .channel(`live-inventory:${shop.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'inventory_items',
        filter: `shop_id=eq.${shop.id}`,
      }, () => {
        void queryClient.invalidateQueries({ queryKey: ['inventory-items', shop.id] })
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'stock_movements',
        filter: `shop_id=eq.${shop.id}`,
      }, () => {
        void queryClient.invalidateQueries({ queryKey: ['stock-movements', shop.id] })
        void queryClient.invalidateQueries({ queryKey: ['inventory-items', shop.id] })
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'product_ingredients',
        filter: `shop_id=eq.${shop.id}`,
      }, () => {
        void queryClient.invalidateQueries({ queryKey: ['product-recipes', shop.id] })
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          toast.error('Live inventory updates disconnected. Check your connection.')
        }
      })

    return () => {
      void supabase?.removeChannel(channel)
    }
  }, [queryClient, shop.id])

  const refreshInventory = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['inventory-items', shop.id] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-products', shop.id] }),
      queryClient.invalidateQueries({ queryKey: ['inventory-suppliers', shop.id] }),
      queryClient.invalidateQueries({ queryKey: ['product-recipes', shop.id] }),
      queryClient.invalidateQueries({ queryKey: ['stock-movements', shop.id] }),
    ])
  }
  const createItem = useMutation({
    mutationFn: async (input: { name: string; unit: string; threshold: number }) => {
      const { error } = await supabase!.rpc('create_inventory_item', {
        target_shop_id: shop.id,
        item_name: input.name,
        item_unit: input.unit,
        low_stock_limit: input.threshold,
      })
      if (error) throw error
    },
    onSuccess: async () => { await refreshInventory(); setModal(null); toast.success('Inventory item added.') },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Inventory item could not be added.'),
  })
  const updateItem = useMutation({
    mutationFn: async (input: { id: string; name: string; unit: string; threshold: number }) => {
      const { error } = await supabase!.from('inventory_items').update({
        name: input.name,
        unit: input.unit,
        low_stock_threshold: input.threshold,
      }).eq('id', input.id).eq('shop_id', shop.id)
      if (error) throw error
    },
    onSuccess: async () => { await refreshInventory(); setModal(null); setSelectedItem(null); toast.success('Inventory item updated.') },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Inventory item could not be updated.'),
  })
  const deleteItem = useMutation({
    mutationFn: async (item: InventoryItem) => {
      const { error } = await supabase!.from('inventory_items').delete().eq('id', item.id).eq('shop_id', shop.id)
      if (error) throw error
    },
    onSuccess: refreshInventory,
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Inventory item could not be removed. Items with stock history cannot be deleted.'),
  })
  const receivePurchase = useMutation({
    mutationFn: async (input: { itemId: string; supplierId: string | null; quantity: number; unitCost: number; notes: string }) => {
      const { error } = await supabase!.rpc('receive_inventory_purchase', {
        target_shop_id: shop.id,
        target_inventory_item_id: input.itemId,
        target_supplier_id: input.supplierId,
        purchased_quantity: input.quantity,
        purchase_unit_cost: input.unitCost,
        purchase_notes: input.notes,
      })
      if (error) throw error
    },
    onSuccess: async () => { await refreshInventory(); setModal(null); toast.success('Purchase received and stock updated.') },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Purchase could not be recorded.'),
  })
  const adjustStock = useMutation({
    mutationFn: async (input: { itemId: string; change: number; reason: string }) => {
      const { error } = await supabase!.rpc('adjust_inventory_stock', {
        target_shop_id: shop.id,
        target_inventory_item_id: input.itemId,
        quantity_change: input.change,
        adjustment_reason: input.reason,
      })
      if (error) throw error
    },
    onSuccess: async () => { await refreshInventory(); setModal(null); toast.success('Stock adjustment recorded.') },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Stock adjustment could not be recorded.'),
  })
  const saveRecipe = useMutation({
    mutationFn: async (input: { productId: string; ingredients: Array<{ inventory_item_id: string; quantity: number }> }) => {
      const { error } = await supabase!.rpc('save_product_recipe', {
        target_shop_id: shop.id,
        target_product_id: input.productId,
        recipe_items: input.ingredients,
      })
      if (error) throw error
    },
    onSuccess: async () => { await refreshInventory(); setRecipeProduct(null); toast.success('Recipe saved.') },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Recipe could not be saved.'),
  })
  const saveSupplier = useMutation({
    mutationFn: async (input: { id?: string; name: string; phone: string; email: string }) => {
      const values = { name: input.name.trim(), phone: input.phone.trim() || null, email: input.email.trim() || null }
      const request = input.id
        ? supabase!.from('suppliers').update(values).eq('id', input.id).eq('shop_id', shop.id)
        : supabase!.from('suppliers').insert({ ...values, shop_id: shop.id })
      const { error } = await request
      if (error) throw error
    },
    onSuccess: async () => { await refreshInventory(); setModal(null); setSelectedSupplier(null); toast.success('Supplier saved.') },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Supplier could not be saved.'),
  })
  const deleteSupplier = useMutation({
    mutationFn: async (supplier: Supplier) => {
      const { error } = await supabase!.from('suppliers').delete().eq('id', supplier.id).eq('shop_id', shop.id)
      if (error) throw error
    },
    onSuccess: refreshInventory,
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Supplier could not be removed.'),
  })
  const saveSettings = useMutation({
    mutationFn: async (input: { inventory_enabled: boolean; allow_negative_stock: boolean }) => {
      const { error } = await supabase!.from('shop_settings').update(input).eq('shop_id', shop.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inventory-settings', shop.id] })
      toast.success('Inventory settings saved.')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Inventory settings could not be saved.'),
  })

  const items = itemsQuery.data ?? []
  const lowStockItems = items.filter((item) => Number(item.quantity) <= Number(item.low_stock_threshold))
  const filteredItems = items.filter((item) => `${item.name} ${item.unit}`.toLowerCase().includes(search.trim().toLowerCase()))
  const recipeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const recipe of recipesQuery.data ?? []) counts.set(recipe.product_id, (counts.get(recipe.product_id) ?? 0) + 1)
    return counts
  }, [recipesQuery.data])

  function showItemModal(kind: 'create' | 'edit', item?: InventoryItem) {
    setSelectedItem(item ?? null)
    setModal(kind)
  }

  function toggleSettings(field: 'inventory_enabled' | 'allow_negative_stock', value: boolean) {
    if (!settingsQuery.data) return
    const next = {
      inventory_enabled: field === 'inventory_enabled' ? value : inventoryEnabled,
      allow_negative_stock: field === 'allow_negative_stock' ? value : allowNegativeStock,
    }
    saveSettings.mutate(next)
  }

  return (
    <section className="page-content inventory-content">
      <div className="welcome-row">
        <div className="page-heading"><p className="eyebrow">STOCK & INGREDIENTS</p><h1>Inventory</h1><p>Track stock, recipes, purchases, and adjustments in one place.</p></div>
        <div className="inventory-header-actions"><button className="button button-secondary" onClick={() => setModal('supplier')}><Factory size={15} /> Add supplier</button><button className="button button-primary" onClick={() => showItemModal('create')}><Plus size={16} /> Add stock item</button></div>
      </div>
      <div className="inventory-summary">
        <div><span className="inventory-summary-icon"><Box size={17} /></span><span>Tracked items</span><strong>{items.length}</strong></div>
        <div><span className="inventory-summary-icon inventory-low-icon"><AlertTriangle size={17} /></span><span>Low stock</span><strong>{lowStockItems.length}</strong></div>
        <div className={`inventory-enable-card ${inventoryEnabled ? 'is-enabled' : ''}`}>
          <div><Settings2 size={16} /><span><strong>Automatic stock tracking</strong><small>Deduct recipe ingredients when a customer orders; restore on cancellation.</small></span></div>
          <button type="button" className={`toggle-switch ${inventoryEnabled ? 'toggle-on' : ''}`} role="switch" aria-checked={inventoryEnabled} disabled={!settingsQuery.data || settingsQuery.isError || saveSettings.isPending || !isManager} onClick={() => toggleSettings('inventory_enabled', !inventoryEnabled)} aria-label="Toggle automatic inventory tracking"><i /></button>
        </div>
      </div>
      {settingsQuery.isError && <div className="inventory-settings-error">Inventory settings could not be loaded. Automatic stock controls are disabled.</div>}
      <div className="inventory-policy-bar"><span className="live-dot" /> Orders that need more stock are rejected unless negative stock is allowed.<span className="inventory-policy-toggle">Allow negative stock<button type="button" className={`toggle-switch toggle-switch-small ${allowNegativeStock ? 'toggle-on' : ''}`} role="switch" aria-checked={allowNegativeStock} disabled={!settingsQuery.data || settingsQuery.isError || saveSettings.isPending || !isManager} onClick={() => toggleSettings('allow_negative_stock', !allowNegativeStock)} aria-label="Toggle negative stock" /></span></div>
      <div className="inventory-tabs" role="tablist" aria-label="Inventory sections">
        <button className={tab === 'stock' ? 'inventory-tab active' : 'inventory-tab'} onClick={() => setTab('stock')}><Box size={15} />Stock</button>
        <button className={tab === 'recipes' ? 'inventory-tab active' : 'inventory-tab'} onClick={() => setTab('recipes')}><ClipboardList size={15} />Recipes</button>
        <button className={tab === 'suppliers' ? 'inventory-tab active' : 'inventory-tab'} onClick={() => setTab('suppliers')}><Factory size={15} />Suppliers</button>
        <button className={tab === 'history' ? 'inventory-tab active' : 'inventory-tab'} onClick={() => setTab('history')}><PackagePlus size={15} />Stock history</button>
      </div>

      {tab === 'stock' && <section className="panel inventory-panel">
        <div className="inventory-panel-heading"><div><h2>Stock items</h2><p>On-hand quantity and reorder thresholds</p></div><label className="menu-search inventory-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find an ingredient…" /></label></div>
        {lowStockItems.length > 0 && <div className="low-stock-alert"><AlertTriangle size={15} /><span><strong>{lowStockItems.length} item{lowStockItems.length === 1 ? '' : 's'} at or below reorder level</strong>{lowStockItems.slice(0, 3).map((item) => ` ${item.name} (${amount(Number(item.quantity))} ${item.unit})`).join(' · ')}</span></div>}
        {itemsQuery.isLoading ? <div className="inventory-empty">Loading stock…</div> : itemsQuery.isError ? <div className="inventory-empty inventory-error">Inventory could not be loaded. Check your connection and permissions.</div> : filteredItems.length ? <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>Ingredient</th><th>On hand</th><th>Reorder at</th><th>Stock status</th><th>Actions</th></tr></thead><tbody>{filteredItems.map((item) => {
          const low = Number(item.quantity) <= Number(item.low_stock_threshold)
          return <tr key={item.id}><td><strong>{item.name}</strong><small>{item.unit}</small></td><td><strong className={low ? 'inventory-quantity-low' : ''}>{amount(Number(item.quantity))}</strong><small>{item.unit}</small></td><td>{amount(Number(item.low_stock_threshold))} {item.unit}</td><td><span className={`inventory-status ${low ? 'inventory-status-low' : 'inventory-status-ok'}`}>{low ? 'Reorder' : 'In stock'}</span></td><td><div className="inventory-row-actions"><button className="button button-secondary button-small" onClick={() => { setSelectedItem(item); setModal('purchase') }}><PackagePlus size={13} />Receive</button><button className="icon-button" title="Adjust stock" aria-label={`Adjust ${item.name} stock`} onClick={() => { setSelectedItem(item); setModal('adjust') }}><Settings2 size={15} /></button><button className="icon-button" title="Edit item" aria-label={`Edit ${item.name}`} onClick={() => showItemModal('edit', item)}><Edit3 size={14} /></button><button className="icon-button inventory-delete" title="Delete item" aria-label={`Delete ${item.name}`} onClick={() => { if (window.confirm(`Delete ${item.name}? Items with stock history cannot be removed.`)) deleteItem.mutate(item) }}><Trash2 size={14} /></button></div></td></tr>
        })}</tbody></table></div> : <div className="inventory-empty"><div className="empty-art"><Box size={22} /></div><strong>{search ? 'No matching ingredients' : 'No inventory items yet'}</strong><span>{search ? 'Try another search.' : 'Add ingredients and set a reorder threshold to begin tracking.'}</span>{!search && <button className="button button-primary button-small" onClick={() => showItemModal('create')}><Plus size={14} />Add first item</button>}</div>}
      </section>}

      {tab === 'recipes' && <section className="panel inventory-panel">
        <div className="inventory-panel-heading"><div><h2>Product recipes</h2><p>Ingredient quantities consumed for one menu item</p></div></div>
        {productsQuery.isLoading || recipesQuery.isLoading ? <div className="inventory-empty">Loading recipes…</div> : productsQuery.isError || recipesQuery.isError ? <div className="inventory-empty inventory-error">Recipes could not be loaded.</div> : productsQuery.data?.length ? <div className="recipe-list">{productsQuery.data.map((product) => {
          const count = recipeCounts.get(product.id) ?? 0
          const ingredients = (recipesQuery.data ?? []).filter((entry) => entry.product_id === product.id)
          return <article className="recipe-row" key={product.id}><div className="recipe-product-icon"><ClipboardList size={16} /></div><div className="recipe-product-info"><strong>{product.name}</strong><span>{count ? ingredients.map((entry) => {
            const ingredient = first(entry.inventory_items)
            return ingredient ? `${amount(Number(entry.quantity))} ${ingredient.unit} ${ingredient.name}` : ''
          }).filter(Boolean).join(' · ') : 'No recipe linked'}</span></div><button className="button button-secondary button-small" disabled={items.length === 0} onClick={() => setRecipeProduct(product)}><Edit3 size={13} />{count ? 'Edit recipe' : 'Add recipe'}</button></article>
        })}</div> : <div className="inventory-empty"><strong>Add products to your menu first</strong><span>Products will be available here to connect ingredients.</span></div>}
        {items.length === 0 && <div className="recipe-hint">Add inventory items before setting up product recipes.</div>}
      </section>}

      {tab === 'suppliers' && <section className="panel inventory-panel">
        <div className="inventory-panel-heading"><div><h2>Suppliers</h2><p>Contacts available when receiving stock</p></div><button className="button button-primary button-small" onClick={() => { setSelectedSupplier(null); setModal('supplier') }}><Plus size={14} />Add supplier</button></div>
        {suppliersQuery.isLoading ? <div className="inventory-empty">Loading suppliers…</div> : suppliersQuery.isError ? <div className="inventory-empty inventory-error">Suppliers could not be loaded.</div> : suppliersQuery.data?.length ? <div className="supplier-list">{suppliersQuery.data.map((supplier) => <article className="supplier-row" key={supplier.id}><div className="supplier-icon"><Factory size={16} /></div><div className="supplier-copy"><strong>{supplier.name}</strong><span>{[supplier.phone, supplier.email].filter(Boolean).join(' · ') || 'No contact details'}</span></div><button className="icon-button" title="Edit supplier" aria-label={`Edit ${supplier.name}`} onClick={() => { setSelectedSupplier(supplier); setModal('supplier') }}><Edit3 size={14} /></button><button className="icon-button inventory-delete" title="Delete supplier" aria-label={`Delete ${supplier.name}`} onClick={() => { if (window.confirm(`Delete supplier ${supplier.name}? Existing purchases will keep their records.`)) deleteSupplier.mutate(supplier) }}><Trash2 size={14} /></button></article>)}</div> : <div className="inventory-empty"><div className="empty-art"><Factory size={22} /></div><strong>No suppliers saved</strong><span>Add suppliers to make stock receiving faster.</span></div>}
      </section>}

      {tab === 'history' && <section className="panel inventory-panel">
        <div className="inventory-panel-heading"><div><h2>Stock movement history</h2><p>Recent purchases, sales consumption, cancellations, and adjustments</p></div><span className="movement-limit">Latest 150</span></div>
        {movementsQuery.isLoading ? <div className="inventory-empty">Loading stock history…</div> : movementsQuery.isError ? <div className="inventory-empty inventory-error">Stock history could not be loaded.</div> : movementsQuery.data?.length ? <div className="movement-list">{movementsQuery.data.map((movement) => {
          const item = first(movement.inventory_items)
          const delta = Number(movement.quantity_delta)
          return <article className="movement-row" key={movement.id}><span className={`movement-sign ${delta > 0 ? 'movement-in' : 'movement-out'}`}>{delta > 0 ? <Plus size={14} /> : <Minus size={14} />}</span><div className="movement-copy"><strong>{item?.name ?? 'Inventory item'}</strong><span>{humanize(movement.reason)}{movement.reference_id ? ` · Ref ${movement.reference_id.slice(0, 8)}` : ''}</span></div><strong className={delta > 0 ? 'movement-amount-in' : 'movement-amount-out'}>{delta > 0 ? '+' : ''}{amount(delta)} {item?.unit ?? ''}</strong><time>{new Date(movement.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time></article>
        })}</div> : <div className="inventory-empty"><div className="empty-art"><PackagePlus size={22} /></div><strong>No stock movements yet</strong><span>Purchases, sales, and adjustments will be recorded here.</span></div>}
      </section>}

      {modal === 'create' && <InventoryItemDialog title="Add inventory item" item={null} pending={createItem.isPending} onClose={() => setModal(null)} onSave={(value) => createItem.mutate(value)} />}
      {modal === 'edit' && selectedItem && <InventoryItemDialog title="Edit inventory item" item={selectedItem} pending={updateItem.isPending} onClose={() => { setModal(null); setSelectedItem(null) }} onSave={(value) => updateItem.mutate({ ...value, id: selectedItem.id })} />}
      {modal === 'purchase' && selectedItem && <PurchaseDialog item={selectedItem} suppliers={suppliersQuery.data ?? []} pending={receivePurchase.isPending} onClose={() => { setModal(null); setSelectedItem(null) }} onSave={(value) => receivePurchase.mutate({ ...value, itemId: selectedItem.id })} />}
      {modal === 'adjust' && selectedItem && <AdjustmentDialog item={selectedItem} pending={adjustStock.isPending} onClose={() => { setModal(null); setSelectedItem(null) }} onSave={(value) => adjustStock.mutate({ ...value, itemId: selectedItem.id })} />}
      {modal === 'supplier' && <SupplierDialog supplier={selectedSupplier} pending={saveSupplier.isPending} onClose={() => { setModal(null); setSelectedSupplier(null) }} onSave={(value) => saveSupplier.mutate({ ...value, ...(selectedSupplier ? { id: selectedSupplier.id } : {}) })} />}
      {recipeProduct && <RecipeDialog product={recipeProduct} items={items} recipes={(recipesQuery.data ?? []).filter((entry) => entry.product_id === recipeProduct.id)} pending={saveRecipe.isPending} onClose={() => setRecipeProduct(null)} onSave={(ingredients) => saveRecipe.mutate({ productId: recipeProduct.id, ingredients })} />}
    </section>
  )
}

function InventoryItemDialog({ title, item, pending, onClose, onSave }: {
  title: string
  item: InventoryItem | null
  pending: boolean
  onClose: () => void
  onSave: (value: { name: string; unit: string; threshold: number }) => void
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [unit, setUnit] = useState(item?.unit ?? '')
  const [threshold, setThreshold] = useState(item ? String(item.low_stock_threshold) : '0')
  const thresholdValue = Number(threshold)
  const valid = name.trim().length >= 2 && unit.trim().length > 0 && Number.isFinite(thresholdValue) && thresholdValue >= 0
  return <Modal title={title} onClose={onClose}><form className="inventory-form" onSubmit={(event) => { event.preventDefault(); if (valid) onSave({ name: name.trim(), unit: unit.trim(), threshold: thresholdValue }) }}>
    <label className="form-field"><span>Ingredient name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="e.g. Oranges" autoFocus /></label>
    <div className="form-grid"><label className="form-field"><span>Unit</span><input value={unit} onChange={(event) => setUnit(event.target.value)} maxLength={24} placeholder="ml, g, pcs" /></label><label className="form-field"><span>Low-stock threshold</span><input type="number" min="0" step="0.001" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label></div>
    {item && <div className="inventory-modal-note">Current stock: {amount(Number(item.quantity))} {item.unit}. Use receive or adjust to change quantity.</div>}
    <ModalActions onClose={onClose} pending={pending} disabled={!valid} saveLabel={item ? 'Save changes' : 'Add item'} />
  </form></Modal>
}

function PurchaseDialog({ item, suppliers, pending, onClose, onSave }: {
  item: InventoryItem
  suppliers: Supplier[]
  pending: boolean
  onClose: () => void
  onSave: (value: { supplierId: string | null; quantity: number; unitCost: number; notes: string }) => void
}) {
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('0')
  const [supplierId, setSupplierId] = useState('')
  const [notes, setNotes] = useState('')
  const quantityValue = Number(quantity)
  const costValue = Number(unitCost)
  const valid = Number.isFinite(quantityValue) && quantityValue > 0 && Math.abs(quantityValue - Math.round(quantityValue * 1000) / 1000) < 1e-8
    && Number.isFinite(costValue) && costValue >= 0 && Math.abs(costValue - Math.round(costValue * 100) / 100) < 1e-8
  return <Modal title={`Receive ${item.name}`} onClose={onClose}><form className="inventory-form" onSubmit={(event) => { event.preventDefault(); if (valid) onSave({ supplierId: supplierId || null, quantity: quantityValue, unitCost: costValue, notes }) }}>
    <div className="inventory-current-stock">On hand <strong>{amount(Number(item.quantity))} {item.unit}</strong></div>
    <label className="form-field"><span>Quantity received ({item.unit})</span><input type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} autoFocus /></label>
    <div className="form-grid"><label className="form-field"><span>Unit cost</span><input type="number" min="0" step="0.01" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} /></label><label className="form-field"><span>Supplier</span><select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">No supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label></div>
    <label className="form-field"><span>Note <small className="optional-label">Optional</small></span><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="Purchase or delivery details" /></label>
    <ModalActions onClose={onClose} pending={pending} disabled={!valid} saveLabel="Receive stock" />
  </form></Modal>
}

function AdjustmentDialog({ item, pending, onClose, onSave }: {
  item: InventoryItem
  pending: boolean
  onClose: () => void
  onSave: (value: { change: number; reason: string }) => void
}) {
  const [direction, setDirection] = useState<'add' | 'remove'>('remove')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const quantityValue = Number(quantity)
  const valid = Number.isFinite(quantityValue) && quantityValue > 0 && Math.abs(quantityValue - Math.round(quantityValue * 1000) / 1000) < 1e-8 && reason.trim().length >= 3
  return <Modal title={`Adjust ${item.name}`} onClose={onClose}><form className="inventory-form" onSubmit={(event) => { event.preventDefault(); if (valid) onSave({ change: direction === 'add' ? quantityValue : -quantityValue, reason: reason.trim() }) }}>
    <div className="inventory-current-stock">Current stock <strong>{amount(Number(item.quantity))} {item.unit}</strong></div>
    <div className="adjustment-direction"><button type="button" className={direction === 'remove' ? 'active' : ''} onClick={() => setDirection('remove')}><Minus size={14} />Remove</button><button type="button" className={direction === 'add' ? 'active' : ''} onClick={() => setDirection('add')}><Plus size={14} />Add</button></div>
    <label className="form-field"><span>Quantity ({item.unit})</span><input type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} autoFocus /></label>
    <label className="form-field"><span>Reason</span><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} placeholder="e.g. Spoilage, count correction" /></label>
    <ModalActions onClose={onClose} pending={pending} disabled={!valid} saveLabel="Save adjustment" />
  </form></Modal>
}

function SupplierDialog({ supplier, pending, onClose, onSave }: {
  supplier: Supplier | null
  pending: boolean
  onClose: () => void
  onSave: (value: { name: string; phone: string; email: string }) => void
}) {
  const [name, setName] = useState(supplier?.name ?? '')
  const [phone, setPhone] = useState(supplier?.phone ?? '')
  const [email, setEmail] = useState(supplier?.email ?? '')
  const valid = name.trim().length >= 2 && (!email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
  return <Modal title={supplier ? 'Edit supplier' : 'Add supplier'} onClose={onClose}><form className="inventory-form" onSubmit={(event) => { event.preventDefault(); if (valid) onSave({ name: name.trim(), phone, email }) }}>
    <label className="form-field"><span>Supplier name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus /></label>
    <div className="form-grid"><label className="form-field"><span>Phone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} /></label><label className="form-field"><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} /></label></div>
    <ModalActions onClose={onClose} pending={pending} disabled={!valid} saveLabel={supplier ? 'Save supplier' : 'Add supplier'} />
  </form></Modal>
}

function RecipeDialog({ product, items, recipes, pending, onClose, onSave }: {
  product: ProductOption
  items: InventoryItem[]
  recipes: RecipeRow[]
  pending: boolean
  onClose: () => void
  onSave: (ingredients: Array<{ inventory_item_id: string; quantity: number }>) => void
}) {
  const [entries, setEntries] = useState(() => recipes.map((recipe) => ({ inventory_item_id: recipe.inventory_item_id, quantity: String(recipe.quantity) })))
  const availableItems = items.filter((item) => !entries.some((entry) => entry.inventory_item_id === item.id))
  const valid = entries.every((entry) => entry.inventory_item_id && Number.isFinite(Number(entry.quantity)) && Number(entry.quantity) > 0)
    && new Set(entries.map((entry) => entry.inventory_item_id)).size === entries.length
  function updateEntry(index: number, patch: Partial<(typeof entries)[number]>) {
    setEntries((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry))
  }
  return <Modal title={`Recipe · ${product.name}`} onClose={onClose} wide><form className="inventory-form" onSubmit={(event) => {
    event.preventDefault()
    if (valid) onSave(entries.map((entry) => ({ inventory_item_id: entry.inventory_item_id, quantity: Number(entry.quantity) })))
  }}>
    <p className="recipe-dialog-help">Set ingredient quantities for one serving. Stock is deducted when an order is placed and restored if it is cancelled.</p>
    <div className="recipe-editor-list">{entries.map((entry, index) => {
      const selectedItem = items.find((item) => item.id === entry.inventory_item_id)
      return <div className="recipe-editor-row" key={`${product.id}:${index}`}>
        <select value={entry.inventory_item_id} onChange={(event) => updateEntry(index, { inventory_item_id: event.target.value })}><option value="">Choose ingredient</option>{items.map((item) => <option key={item.id} value={item.id} disabled={entries.some((other, otherIndex) => otherIndex !== index && other.inventory_item_id === item.id)}>{item.name} ({item.unit})</option>)}</select>
        <label><span>Qty {selectedItem?.unit ?? ''}</span><input type="number" min="0.001" step="0.001" value={entry.quantity} onChange={(event) => updateEntry(index, { quantity: event.target.value })} /></label>
        <button type="button" className="icon-button inventory-delete" aria-label="Remove ingredient" onClick={() => setEntries((current) => current.filter((_item, entryIndex) => entryIndex !== index))}><Trash2 size={14} /></button>
      </div>
    })}</div>
    <button type="button" className="button button-secondary recipe-add-row" disabled={availableItems.length === 0} onClick={() => setEntries((current) => [...current, { inventory_item_id: availableItems[0].id, quantity: '1' }])}><Plus size={14} />Add ingredient</button>
    {entries.length === 0 && <div className="recipe-hint">No ingredients selected. Saving an empty recipe removes automatic stock tracking for this product.</div>}
    <ModalActions onClose={onClose} pending={pending} disabled={!valid} saveLabel="Save recipe" />
  </form></Modal>
}

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return <div className="checkout-overlay order-dialog-overlay inventory-modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className={`checkout-modal inventory-dialog ${wide ? 'inventory-dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="checkout-head"><div><p className="eyebrow">INVENTORY</p><h2>{title}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>{children}</section></div>
}

function ModalActions({ onClose, pending, disabled, saveLabel }: { onClose: () => void; pending: boolean; disabled: boolean; saveLabel: string }) {
  return <div className="inventory-modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={disabled || pending}>{pending ? 'Saving…' : saveLabel}</button></div>
}
