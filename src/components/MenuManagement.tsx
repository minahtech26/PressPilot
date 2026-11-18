import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { ImagePlus, Leaf, Plus, Search, Star, Trash2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Shop } from '../lib/types'
import { supabase } from '../lib/supabase'

interface Category {
  id: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

interface Variant {
  id: string
  name: string
  price: number
}

interface CustomizationOption {
  id: string
  name: string
  price_delta: number
}

interface ProductCustomizationGroup {
  id: string
  name: string
  is_required: boolean
  customization_options: CustomizationOption[]
}

interface Product {
  id: string
  category_id: string | null
  name: string
  sku: string | null
  description: string | null
  image_url: string | null
  base_price: number
  is_available: boolean
  is_featured: boolean
  product_variants: Variant[]
  customization_groups: ProductCustomizationGroup[]
}

const productSchema = z.object({
  name: z.string().trim().min(1, 'Enter a product name').max(120),
  category_id: z.string().min(1, 'Choose a category'),
  sku: z.string().trim().max(80),
  description: z.string().trim().max(500),
  base_price: z.coerce.number().min(0, 'Price must be zero or more'),
  variants_text: z.string().max(500),
  is_available: z.boolean(),
  is_featured: z.boolean(),
}).superRefine((values, ctx) => {
  const rows = values.variants_text.split('\n').map((line) => line.trim()).filter(Boolean)
  if (rows.length > 20) ctx.addIssue({ code: 'custom', path: ['variants_text'], message: 'Add no more than 20 sizes' })
  rows.forEach((row, index) => {
    if (!/^.{1,50}:\s*\d+(?:\.\d{1,2})?$/.test(row)) {
      ctx.addIssue({ code: 'custom', path: ['variants_text'], message: `Use “Size: price” on line ${index + 1}` })
    }
  })
})

type ProductValues = z.output<typeof productSchema>

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

export function MenuManagement({ shop }: { shop: Shop }) {
  const queryClient = useQueryClient()
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [search, setSearch] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [categoryDescription, setCategoryDescription] = useState('')

  const categoriesQuery = useQuery({
    queryKey: ['categories', shop.id],
    queryFn: async () => {
      const { data, error } = await supabase!.from('categories').select('*').eq('shop_id', shop.id).order('sort_order').order('name')
      if (error) throw error
      return data as Category[]
    },
  })

  const productsQuery = useQuery({
    queryKey: ['products', shop.id],
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('products')
        .select('*, product_variants(*)')
        .eq('shop_id', shop.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      const { data: mappings, error: mappingError } = await supabase!
        .from('product_customization_groups')
        .select('product_id, customization_groups(id,name,is_required,customization_options(id,name,price_delta))')
        .eq('shop_id', shop.id)
      if (mappingError) throw mappingError
      const customizationByProduct = new Map<string, ProductCustomizationGroup[]>()
      for (const mapping of (mappings ?? []) as Array<{ product_id: string; customization_groups: ProductCustomizationGroup | ProductCustomizationGroup[] | null }>) {
        const groupValue = mapping.customization_groups
        const groups = Array.isArray(groupValue) ? groupValue : groupValue ? [groupValue] : []
        customizationByProduct.set(mapping.product_id, [...(customizationByProduct.get(mapping.product_id) ?? []), ...groups])
      }
      return (data as Omit<Product, 'customization_groups'>[]).map((product) => ({
        ...product,
        customization_groups: customizationByProduct.get(product.id) ?? [],
      }))
    },
  })

  const form = useForm<z.input<typeof productSchema>, unknown, ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '',
      category_id: '',
      sku: '',
      description: '',
      base_price: 0,
      variants_text: '',
      is_available: true,
      is_featured: false,
    },
  })

  function resetProduct() {
    setSelectedProduct(null)
    setImageFile(null)
    form.reset({
      name: '',
      category_id: '',
      sku: '',
      description: '',
      base_price: 0,
      variants_text: '',
      is_available: true,
      is_featured: false,
    })
  }

  function editProduct(product: Product) {
    setSelectedProduct(product)
    setImageFile(null)
    form.reset({
      name: product.name,
      category_id: product.category_id ?? '',
      sku: product.sku ?? '',
      description: product.description ?? '',
      base_price: product.base_price,
      variants_text: product.product_variants.map((variant) => `${variant.name}: ${variant.price}`).join('\n'),
      is_available: product.is_available,
      is_featured: product.is_featured,
    })
  }

  const saveProduct = useMutation({
    mutationFn: async (values: ProductValues) => {
      if (!supabase) throw new Error('Supabase is not configured.')
      let imageUrl = selectedProduct?.image_url ?? ''
      let uploadedPath: string | null = null
      if (imageFile) {
        const extension = imageFile.name.split('.').pop()?.toLowerCase() || 'jpg'
        uploadedPath = `${shop.id}/${crypto.randomUUID()}.${extension}`
        const { error: uploadError } = await supabase.storage.from('menu-images').upload(uploadedPath, imageFile, {
          cacheControl: '3600',
          contentType: imageFile.type,
          upsert: false,
        })
        if (uploadError) throw uploadError
        imageUrl = supabase.storage.from('menu-images').getPublicUrl(uploadedPath).data.publicUrl
      }

      const variants = values.variants_text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const separator = line.lastIndexOf(':')
        return { name: line.slice(0, separator).trim(), price: Number(line.slice(separator + 1).trim()) }
      })
      const customizations = selectedProduct?.customization_groups.map((group) => ({
        name: group.name,
        options: group.customization_options.map((option) => ({
          name: option.name,
          price_delta: Number(option.price_delta),
        })),
      })) ?? []

      const { error } = await supabase.rpc('save_menu_product', {
        target_shop_id: shop.id,
        target_product_id: selectedProduct?.id ?? null,
        target_category_id: values.category_id || null,
        product_name: values.name,
        product_sku: values.sku,
        product_description: values.description,
        product_image_url: imageUrl,
        product_base_price: values.base_price,
        product_available: values.is_available,
        product_featured: values.is_featured,
        product_variants: variants,
        product_customizations: customizations,
      })
      if (error) {
        if (uploadedPath) await supabase.storage.from('menu-images').remove([uploadedPath])
        throw error
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['products', shop.id] })
      toast.success(selectedProduct ? 'Product updated' : 'Product added')
      resetProduct()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const addCategory = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const name = categoryName.trim()
      if (name.length < 2) throw new Error('Category name must be at least 2 characters.')
      const { error } = await supabase.from('categories').insert({
        shop_id: shop.id,
        name,
        description: categoryDescription.trim() || null,
        sort_order: categoriesQuery.data?.length ?? 0,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      setCategoryName('')
      setCategoryDescription('')
      await queryClient.invalidateQueries({ queryKey: ['categories', shop.id] })
      toast.success('Category created')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const deleteCategory = useMutation({
    mutationFn: async (categoryId: string) => {
      if (!supabase) throw new Error('Supabase is not configured.')
      if (products.some((product) => product.category_id === categoryId)) {
        throw new Error('Move or remove this category’s products before deleting it.')
      }
      const { error } = await supabase.from('categories').delete().eq('id', categoryId).eq('shop_id', shop.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['categories', shop.id] }),
        queryClient.invalidateQueries({ queryKey: ['products', shop.id] }),
      ])
      toast.success('Category removed')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const deleteProduct = useMutation({
    mutationFn: async (productId: string) => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { error } = await supabase.from('products').delete().eq('id', productId).eq('shop_id', shop.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['products', shop.id] })
      toast.success('Product removed')
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const categories = categoriesQuery.data ?? []
  const products = productsQuery.data ?? []
  const filteredProducts = products.filter((product) => {
    const text = `${product.name} ${product.sku ?? ''}`.toLowerCase()
    return text.includes(search.toLowerCase())
  })

  return (
    <section className="page-content menu-admin">
      <div className="welcome-row">
        <div className="page-heading">
          <p className="eyebrow">YOUR DIGITAL MENU</p>
          <h1>Menu & products</h1>
          <p>Manage the categories and items your customers see when they scan a QR code.</p>
        </div>
        <button className="button button-primary" onClick={() => { resetProduct(); document.getElementById('product-editor')?.scrollIntoView({ behavior: 'smooth' }) }}>
          <Plus size={16} /> Add product
        </button>
      </div>

      <div className="menu-admin-grid">
        <div className="panel category-panel">
          <div className="panel-header"><div><h3>Categories</h3><p>Keep the menu easy to browse</p></div><span className="round-count">{categories.length}</span></div>
          <form className="category-form" onSubmit={(event) => { event.preventDefault(); addCategory.mutate() }}>
            <label className="form-field"><span>Category name</span><input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="e.g. Fresh juices" maxLength={80} required /></label>
            <label className="form-field"><span>Short description <small>Optional</small></span><input value={categoryDescription} onChange={(event) => setCategoryDescription(event.target.value)} placeholder="Freshly squeezed favorites" maxLength={240} /></label>
            <button type="submit" className="button button-secondary" disabled={addCategory.isPending}><Plus size={15} /> Add category</button>
          </form>
          <div className="category-list">
            {categoriesQuery.isLoading ? <p className="menu-empty">Loading categories…</p> : categoriesQuery.isError ? <p className="menu-error">Categories could not be loaded.</p> : categories.length ? categories.map((category) => (
              <div className="category-row" key={category.id}>
                <span className="category-dot" />
                <div><strong>{category.name}</strong><small>{products.filter((product) => product.category_id === category.id).length} products</small></div>
                <button className="icon-button danger-icon" aria-label={`Delete ${category.name}`} onClick={() => {
                  if (window.confirm(`Remove "${category.name}"? Products will remain but become uncategorized.`)) deleteCategory.mutate(category.id)
                }}><Trash2 size={15} /></button>
              </div>
            )) : <p className="menu-empty">Add your first category to organize the menu.</p>}
          </div>
        </div>

        <div className="panel products-panel">
          <div className="panel-header">
            <div><h3>Products</h3><p>{products.length} items in your shop menu</p></div>
            <label className="menu-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" /></label>
          </div>
          <div className="product-list">
            {productsQuery.isLoading ? <p className="menu-empty">Loading products…</p> : productsQuery.isError ? <p className="menu-error">Products could not be loaded.</p> : filteredProducts.length ? filteredProducts.map((product) => (
              <article className="admin-product" key={product.id}>
                <div className="admin-product-image">{product.image_url ? <img src={product.image_url} alt="" /> : <ImagePlus size={19} />}</div>
                <div className="admin-product-copy">
                  <div className="admin-product-title">{product.is_featured && <Star size={13} fill="currentColor" />}<strong>{product.name}</strong></div>
                  <span>{categories.find((category) => category.id === product.category_id)?.name ?? 'Uncategorized'}{product.sku ? ` · ${product.sku}` : ''}</span>
                  <small>{product.product_variants.length ? product.product_variants.map((variant) => `${variant.name} ₹${Number(variant.price).toFixed(0)}`).join(' · ') : `₹${Number(product.base_price).toFixed(2)}`}</small>
                  {product.customization_groups.length > 0 && <small>{product.customization_groups.length} customization {product.customization_groups.length === 1 ? 'group' : 'groups'}</small>}
                </div>
                <span className={`availability-pill ${product.is_available ? 'available' : 'unavailable'}`}>{product.is_available ? 'Available' : 'Hidden'}</span>
                <button className="button button-secondary button-small" onClick={() => { editProduct(product); document.getElementById('product-editor')?.scrollIntoView({ behavior: 'smooth' }) }}>Edit</button>
                <button className="icon-button danger-icon" aria-label={`Delete ${product.name}`} onClick={() => {
                  if (window.confirm(`Delete "${product.name}" from the menu?`)) deleteProduct.mutate(product.id)
                }}><Trash2 size={15} /></button>
              </article>
            )) : <div className="menu-empty-block"><ImagePlus size={25} /><strong>{search ? 'No matching products' : 'Your menu starts here'}</strong><span>{search ? 'Try another search.' : 'Add a product to make it available on your digital menu.'}</span></div>}
          </div>
        </div>
      </div>

      <div className="panel product-editor-panel" id="product-editor">
        <div className="product-editor-head">
          <div><h3>{selectedProduct ? 'Edit product' : 'Add a product'}</h3><p>Prices are stored on your shop and used to calculate QR orders.</p></div>
          {selectedProduct && <button className="icon-button" aria-label="Close editor" onClick={resetProduct}><X size={18} /></button>}
        </div>
        <form className="product-editor-form" onSubmit={form.handleSubmit((values) => saveProduct.mutate(values))}>
          <div className="product-editor-fields">
            <label className="form-field"><span>Product name</span><input placeholder="e.g. Sunrise orange juice" {...form.register('name')} />{form.formState.errors.name && <small className="field-error">{form.formState.errors.name.message}</small>}</label>
            <label className="form-field"><span>Category</span><select {...form.register('category_id')}><option value="">Choose a category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select>{form.formState.errors.category_id && <small className="field-error">{form.formState.errors.category_id.message}</small>}</label>
            <label className="form-field"><span>SKU <small>Optional</small></span><input placeholder="OJ-001" {...form.register('sku')} /></label>
            <label className="form-field"><span>Base price (₹)</span><input type="number" min="0" step="0.01" {...form.register('base_price')} />{form.formState.errors.base_price && <small className="field-error">{form.formState.errors.base_price.message}</small>}</label>
            <label className="form-field editor-wide"><span>Description <small>Optional</small></span><textarea rows={2} placeholder="A short description for your customers" {...form.register('description')} /></label>
            <label className="form-field editor-wide"><span>Size variants <small>One per line, optional</small></span><textarea rows={3} placeholder={'Small: 80\nMedium: 120\nLarge: 160'} {...form.register('variants_text')} />{form.formState.errors.variants_text && <small className="field-error">{form.formState.errors.variants_text.message}</small>}</label>
            <label className="form-field"><span>Product photo <small>JPG, PNG or WebP · 5 MB max</small></span><span className="file-control"><Upload size={15} /><span>{imageFile?.name ?? (selectedProduct?.image_url ? 'Replace current photo' : 'Choose an image')}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
              const file = event.target.files?.[0] ?? null
              if (file && file.size > 5 * 1024 * 1024) {
                toast.error('Images must be 5 MB or smaller.')
                event.target.value = ''
                return
              }
              setImageFile(file)
            }} /></span></label>
            <div className="product-checks"><label><input type="checkbox" {...form.register('is_available')} /><span>Available on menu</span></label><label><input type="checkbox" {...form.register('is_featured')} /><span><Star size={14} /> Featured</span></label></div>
          </div>
          <div className="editor-actions"><span><Leaf size={14} /> Customers only see available items.</span><button type="submit" className="button button-primary" disabled={saveProduct.isPending}>{saveProduct.isPending ? 'Saving…' : selectedProduct ? 'Save product' : 'Add product'} <Plus size={15} /></button></div>
        </form>
      </div>
    </section>
  )
}
