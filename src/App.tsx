import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import type { Session, User } from '@supabase/supabase-js'
import {
  ArrowRight,
  Bell,
  Box,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  CreditCard,
  DoorOpen,
  Eye,
  EyeOff,
  FileText,
  Flame,
  LayoutDashboard,
  Leaf,
  LockKeyhole,
  Mail,
  Menu,
  Settings,
  ShieldCheck,
  ShoppingBasket,
  Store,
  Table2,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import type { Shop, ShopRole } from './lib/types'
import { useLiveNotifications } from './lib/useLiveNotifications'

const MenuManagement = lazy(() => import('./components/MenuManagement').then((module) => ({ default: module.MenuManagement })))
const PublicMenu = lazy(() => import('./components/PublicMenu').then((module) => ({ default: module.PublicMenu })))
const PublicOrderConfirmation = lazy(() => import('./components/PublicMenu').then((module) => ({ default: module.PublicOrderConfirmation })))
const TableManagement = lazy(() => import('./components/TableManagement').then((module) => ({ default: module.TableManagement })))
const OrderManagement = lazy(() => import('./components/OrderManagement').then((module) => ({ default: module.OrderManagement })))
const KitchenDashboard = lazy(() => import('./components/KitchenDashboard').then((module) => ({ default: module.KitchenDashboard })))
const NotificationsPage = lazy(() => import('./components/NotificationsPage').then((module) => ({ default: module.NotificationsPage })))
const BillingManagement = lazy(() => import('./components/BillingManagement').then((module) => ({ default: module.BillingManagement })))
const InventoryManagement = lazy(() => import('./components/InventoryManagement').then((module) => ({ default: module.InventoryManagement })))
const ReportingManagement = lazy(() => import('./components/ReportingManagement').then((module) => ({ default: module.ReportingManagement })))
const SuperAdminDashboard = lazy(() => import('./components/SuperAdminDashboard').then((module) => ({ default: module.SuperAdminDashboard })))

const signInSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

const signUpSchema = signInSchema.extend({
  name: z.string().trim().min(2, 'Enter your name'),
})

const shopSchema = z.object({
  name: z.string().trim().min(2, 'Shop name must be at least 2 characters').max(80),
  phone: z.string().trim().max(30).optional(),
  email: z.union([z.string().email(), z.literal('')]).optional(),
  address: z.string().trim().max(240).optional(),
})

type SignInValues = z.infer<typeof signInSchema>
type SignUpValues = z.infer<typeof signUpSchema>
type ShopValues = z.infer<typeof shopSchema>

const navigation = [
  { label: 'Overview', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Orders', path: '/dashboard/orders', icon: ShoppingBasket },
  { label: 'Kitchen', path: '/dashboard/kitchen', icon: Flame },
  { label: 'Tables & QR', path: '/dashboard/tables', icon: Table2 },
  { label: 'Menu', path: '/dashboard/menu', icon: BookOpen },
  { label: 'Billing', path: '/dashboard/billing', icon: CreditCard },
  { label: 'Inventory', path: '/dashboard/inventory', icon: Box },
  { label: 'Reports', path: '/dashboard/reports', icon: FileText },
  { label: 'Platform admin', path: '/admin', icon: ShieldCheck },
]

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) toast.error(error.message)
      if (active) {
        setSession(data.session)
        setAuthLoading(false)
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthLoading(false)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const user = session?.user ?? null
  const { data: shops, isLoading: shopsLoading } = useQuery({
    queryKey: ['shops', user?.id],
    enabled: Boolean(user && supabase),
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('shop_members')
        .select('shop:shops(id,name,slug,address,phone,email,gstin,currency,created_at),role')
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []).flatMap((membership) => {
        const shop = Array.isArray(membership.shop) ? membership.shop[0] : membership.shop
        return shop ? [{ shop: shop as Shop, role: membership.role as ShopRole }] : []
      })
    },
  })
  const superAdminQuery = useQuery({
    queryKey: ['super-admin-role', user?.id],
    enabled: Boolean(user && supabase),
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('profiles')
        .select('is_super_admin')
        .eq('id', user!.id)
        .single()
      if (error) throw error
      return data.is_super_admin === true
    },
  })

  if (!isSupabaseConfigured) return <SetupPage />
  if (authLoading) return <LoadingPage />

  return (
    <Routes>
      <Route path="/menu/:shopSlug/order/:orderId" element={<Suspense fallback={<LoadingPage />}><PublicOrderConfirmation /></Suspense>} />
      <Route path="/menu/:shopSlug" element={<Suspense fallback={<LoadingPage />}><PublicMenu /></Suspense>} />
      <Route
        path="/admin/*"
        element={user
          ? superAdminQuery.isLoading
            ? <LoadingPage />
            : superAdminQuery.isError
              ? <main className="setup-page"><section className="setup-card"><ShieldCheck size={26} /><h1>Admin access could not be checked</h1><p className="muted">Reload the page or contact your database administrator.</p><Link className="text-link" to="/dashboard">Return to workspace <ArrowRight size={15} /></Link></section></main>
              : superAdminQuery.data
                ? <Suspense fallback={<LoadingPage />}><SuperAdminDashboard user={user} /></Suspense>
                : <Navigate to="/dashboard" replace />
          : <Navigate to="/login" replace />}
      />
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <AuthPage mode="login" />} />
      <Route path="/register" element={user ? <Navigate to="/dashboard" replace /> : <AuthPage mode="register" />} />
      <Route path="/forgot-password" element={user ? <Navigate to="/dashboard" replace /> : <ForgotPasswordPage />} />
      <Route
        path="/onboarding"
        element={user ? <OnboardingPage user={user} /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/dashboard/*"
        element={
          user
            ? shopsLoading
              ? <LoadingPage />
              : shops?.length
                ? <Dashboard user={user} shop={shops[0].shop} role={shops[0].role} isSuperAdmin={superAdminQuery.data === true} />
                : superAdminQuery.isLoading
                  ? <LoadingPage />
                  : superAdminQuery.data
                    ? <Navigate to="/admin" replace />
                    : <Navigate to="/onboarding" replace />
            : <Navigate to="/login" replace />
        }
      />
      <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
    </Routes>
  )
}

function SetupPage() {
  return (
    <main className="setup-page">
      <div className="setup-card">
        <div className="brand-mark"><Leaf size={22} /></div>
        <p className="eyebrow">Freshdesk setup</p>
        <h1>Connect your shop workspace</h1>
        <p className="muted">Add your Supabase project credentials to start setting up your shop securely.</p>
        <div className="setup-steps">
          <div><span>1</span><p>Create a Supabase project and run the migrations in <code>supabase/migrations/</code> order.</p></div>
          <div><span>2</span><p>Copy <code>.env.example</code> to <code>.env.local</code> and fill in your project URL and anon key.</p></div>
          <div><span>3</span><p>Restart the development server. Never put a service-role key in the browser app.</p></div>
        </div>
        <a className="text-link" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Open Supabase dashboard <ArrowRight size={15} /></a>
      </div>
    </main>
  )
}

function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const isRegister = mode === 'register'
  const form = useForm<SignInValues | SignUpValues>({
    resolver: zodResolver(isRegister ? signUpSchema : signInSchema),
    defaultValues: { email: '', password: '', ...(isRegister ? { name: '' } : {}) },
  })
  const mutation = useMutation({
    mutationFn: async (values: SignInValues | SignUpValues) => {
      if (!supabase) throw new Error('Supabase is not configured.')
      if (isRegister) {
        const registerValues = values as SignUpValues
        const { data, error } = await supabase.auth.signUp({
          email: registerValues.email,
          password: registerValues.password,
          options: { data: { full_name: registerValues.name } },
        })
        if (error) throw error
        return data
      }
      const { data, error } = await supabase.auth.signInWithPassword(values)
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      if (isRegister && !data.session) {
        setMessage('Check your email to confirm your account, then sign in to create your shop.')
      } else {
        toast.success(isRegister ? 'Account created' : 'Welcome back')
        navigate('/dashboard', { replace: true })
      }
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  const errors = form.formState.errors

  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link to="/login" className="brand"><span className="brand-mark"><Leaf size={21} /></span>freshdesk</Link>
        <div className="story-copy">
          <div className="story-pill"><span className="live-dot" /> BUILT FOR THE DAILY RUSH</div>
          <h1>Good things,<br /><em>made simple.</em></h1>
          <p>One calm place to run your juice bar — from the first order to the last sip.</p>
          <div className="story-stats"><div><strong>01</strong><span>Set up your shop</span></div><div><strong>02</strong><span>Bring your team in</span></div><div><strong>03</strong><span>Serve something fresh</span></div></div>
        </div>
        <div className="story-footer"><span>Made for independent shops</span><span>© 2026 Freshdesk</span></div>
        <div className="story-orb orb-one" /><div className="story-orb orb-two" />
      </section>
      <section className="auth-panel">
        <div className="auth-topline"><span>{isRegister ? 'GET STARTED' : 'YOUR WORKSPACE'}</span><Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Sign in' : 'Create account'} <ArrowRight size={15} /></Link></div>
        <div className="auth-form-wrap">
          <div className="mini-icon"><Store size={20} /></div>
          <p className="eyebrow">{isRegister ? 'A FRESH START' : 'WELCOME BACK'}</p>
          <h2>{isRegister ? 'Create your account' : 'Sign in to Freshdesk'}</h2>
          <p className="muted">{isRegister ? 'Start with your account. You’ll add your shop next.' : 'Your shop is ready when you are.'}</p>
          {message && <div className="notice-success"><Check size={17} />{message}</div>}
          <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="form-stack">
            {isRegister && <FormField label="Your name" error={'name' in errors ? errors.name?.message : undefined}><input placeholder="e.g. Maya Patel" autoComplete="name" {...form.register('name' as never)} /></FormField>}
            <FormField label="Email address" error={errors.email?.message}><div className="input-icon"><Mail size={17} /><input type="email" placeholder="you@yourshop.com" autoComplete="email" {...form.register('email')} /></div></FormField>
            <FormField label="Password" error={errors.password?.message}><div className="input-icon"><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} placeholder="At least 8 characters" autoComplete={isRegister ? 'new-password' : 'current-password'} {...form.register('password')} /><button className="icon-button" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></FormField>
            {!isRegister && <div className="form-meta"><span><ShieldCheck size={14} /> Secure sign-in</span><Link to="/forgot-password">Forgot password?</Link></div>}
            <button type="submit" className="button button-primary button-wide" disabled={mutation.isPending}>{mutation.isPending ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'} <ArrowRight size={16} /></button>
          </form>
          <p className="auth-switch">{isRegister ? 'Already have an account?' : 'New to Freshdesk?'} <Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Sign in' : 'Create an account'}</Link></p>
          <p className="auth-privacy"><LockKeyhole size={13} /> Your shop data is protected and only visible to your team.</p>
        </div>
      </section>
    </main>
  )
}

function ForgotPasswordPage() {
  const form = useForm<{ email: string }>({ defaultValues: { email: '' }, resolver: zodResolver(z.object({ email: z.string().email() })) })
  const mutation = useMutation({
    mutationFn: async ({ email }: { email: string }) => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login` })
      if (error) throw error
    },
    onSuccess: () => toast.success('If an account exists for that email, a reset link is on its way.'),
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  return (
    <main className="auth-page">
      <section className="auth-story"><Link to="/login" className="brand"><span className="brand-mark"><Leaf size={21} /></span>freshdesk</Link><div className="story-copy"><div className="story-pill"><span className="live-dot" /> YOU’RE IN GOOD HANDS</div><h1>A little reset,<br /><em>then you’re back.</em></h1><p>We’ll send a secure link to the email address on your account.</p></div><div className="story-footer"><span>Made for independent shops</span><span>© 2026 Freshdesk</span></div></section>
      <section className="auth-panel"><div className="auth-topline"><span>ACCOUNT RECOVERY</span><Link to="/login">Back to sign in <ArrowRight size={15} /></Link></div><div className="auth-form-wrap"><div className="mini-icon"><Mail size={20} /></div><p className="eyebrow">PASSWORD RESET</p><h2>Forgot your password?</h2><p className="muted">Enter the email you use for Freshdesk.</p><form className="form-stack recovery-form" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}><FormField label="Email address" error={form.formState.errors.email?.message}><div className="input-icon"><Mail size={17} /><input type="email" placeholder="you@yourshop.com" {...form.register('email')} /></div></FormField><button className="button button-primary button-wide" disabled={mutation.isPending}>{mutation.isPending ? 'Sending…' : 'Send reset link'} <ArrowRight size={16} /></button></form></div></section>
    </main>
  )
}

function OnboardingPage({ user }: { user: User }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const form = useForm<ShopValues>({
    resolver: zodResolver(shopSchema),
    defaultValues: { name: '', phone: '', email: user.email ?? '', address: '' },
  })
  const mutation = useMutation({
    mutationFn: async (values: ShopValues) => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { data, error } = await supabase.rpc('create_shop', {
        shop_name: values.name,
        shop_phone: values.phone || null,
        shop_email: values.email || null,
        shop_address: values.address || null,
      })
      if (error) throw error
      return data
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['shops', user.id] })
      toast.success('Workspace created. Opening your dashboard…')
      navigate('/dashboard', { replace: true })
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  return (
    <main className="onboarding-page">
      <Link to="/login" className="brand"><span className="brand-mark"><Leaf size={21} /></span>freshdesk</Link>
      <div className="onboarding-card">
        <div className="step-count">STEP <strong>01</strong> <span>OF 01</span></div>
        <div className="mini-icon"><Store size={20} /></div>
        <p className="eyebrow">YOUR SHOP</p>
        <h1>Let’s get your shop set up.</h1>
        <p className="muted">This creates a private workspace for you and your team.</p>
        <form className="form-stack" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
          <FormField label="Shop name" error={form.formState.errors.name?.message}><input placeholder="e.g. The Green Press" {...form.register('name')} /></FormField>
          <div className="form-grid">
            <FormField label="Phone number" error={form.formState.errors.phone?.message}><input placeholder="+91 98765 43210" {...form.register('phone')} /></FormField>
            <FormField label="Shop email" error={form.formState.errors.email?.message}><input type="email" placeholder="hello@shop.com" {...form.register('email')} /></FormField>
          </div>
          <FormField label="Address" error={form.formState.errors.address?.message}><input placeholder="Street, city, PIN code" {...form.register('address')} /></FormField>
          <button type="submit" className="button button-primary button-wide" disabled={mutation.isPending}>{mutation.isPending ? 'Creating workspace…' : 'Create shop workspace'} <ArrowRight size={16} /></button>
        </form>
        <p className="auth-privacy"><ShieldCheck size={14} /> Your shop data is visible only to members you invite.</p>
      </div>
    </main>
  )
}

function Dashboard({ user, shop, role, isSuperAdmin }: { user: User; shop: Shop; role: ShopRole; isSuperAdmin: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const queryClient = useQueryClient()
  const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Shop owner'
  const initials = name.split(/\s+/).slice(0, 2).map((part: string) => part[0]?.toUpperCase()).join('')
  const canManageShop = role === 'owner' || role === 'manager'
  const activeSection = useMemo(() => location.pathname.split('/')[2] || 'overview', [location.pathname])
  const unreadNotifications = useQuery({
    queryKey: ['notification-count', shop.id],
    queryFn: async () => {
      const { count, error } = await supabase!
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('shop_id', shop.id)
        .is('read_at', null)
      if (error) throw error
      return count ?? 0
    },
    enabled: Boolean(supabase),
  })
  useLiveNotifications(shop.id)
  const sectionTitles: Record<string, string> = {
    overview: 'Overview',
    orders: 'Orders',
    kitchen: 'Kitchen display',
    notifications: 'Notifications',
    billing: 'Billing',
    inventory: 'Inventory',
    reports: 'Reports',
    menu: 'Menu & products',
    tables: 'Tables & QR',
    settings: 'Shop settings',
  }
  const shopForm = useForm<ShopValues>({
    defaultValues: { name: shop.name, phone: shop.phone ?? '', email: shop.email ?? '', address: shop.address ?? '' },
    resolver: zodResolver(shopSchema),
  })
  const saveShop = useMutation({
    mutationFn: async (values: ShopValues) => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { error } = await supabase.from('shops').update({
        name: values.name,
        phone: values.phone || null,
        email: values.email || null,
        address: values.address || null,
      }).eq('id', shop.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['shops', user.id] })
      setEditing(false)
      toast.success('Shop details updated')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

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
    <div className="dashboard-shell">
      {mobileNavOpen && <button className="mobile-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand"><Link to="/dashboard" className="brand"><span className="brand-mark"><Leaf size={20} /></span><span>freshdesk</span></Link><button className="icon-button mobile-close" onClick={() => setMobileNavOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
        <div className="workspace-switcher"><div className="shop-avatar"><Store size={16} /></div><div className="workspace-copy"><strong>{shop.name}</strong><span>Shop workspace</span></div><ChevronDown size={16} /></div>
        <div className="nav-heading">WORKSPACE</div>
        <nav className="side-nav">
          {navigation.filter((item) => (item.label !== 'Billing' || role !== 'kitchen') && (item.label !== 'Inventory' || canManageShop) && (item.label !== 'Reports' || canManageShop) && (item.label !== 'Platform admin' || isSuperAdmin)).map(({ label, path, icon: Icon }) => {
            const active = path === '/dashboard' ? activeSection === 'overview' : path.endsWith(`/${activeSection}`)
            return <Link key={label} to={path} className={`nav-item ${active ? 'nav-active' : ''}`} onClick={() => setMobileNavOpen(false)}><Icon size={18} /><span>{label}</span>{active && <span className="nav-indicator" />}</Link>
          })}
        </nav>
        <div className="nav-heading tools-heading">ACCOUNT</div>
        <nav className="side-nav">
          <button className={`nav-item ${activeSection === 'settings' ? 'nav-active' : ''}`} onClick={() => { navigate('/dashboard/settings'); setEditing(canManageShop); setMobileNavOpen(false) }}><Settings size={18} /><span>Shop settings</span></button>
          <div className="nav-item nav-disabled"><Users size={18} /><span>Team</span><span className="nav-coming">Next</span></div>
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><div className="help-icon"><CircleHelp size={17} /></div><strong>Need a hand?</strong><span>We’re here to help you get set up.</span><button onClick={() => toast.info('Help center will be available soon.')}>Visit help center <ArrowRight size={13} /></button></div>
          <div className="profile-menu"><div className="user-avatar">{initials}</div><div className="profile-info"><strong>{name}</strong><span>{role}</span></div><button className="sidebar-signout" onClick={signOut}><DoorOpen size={16} /><span>Sign out</span></button></div>
        </div>
      </aside>
      <main className="dashboard-main">
        <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open menu"><Menu size={20} /></button><div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{sectionTitles[activeSection] ?? 'Overview'}</strong></div></div><div className="topbar-actions"><div className="status-chip"><span className="live-dot" /> All systems operational</div><button className={`top-icon ${activeSection === 'notifications' ? 'top-icon-active' : ''}`} onClick={() => navigate('/dashboard/notifications')} aria-label={`Notifications${(unreadNotifications.data ?? 0) > 0 ? `, ${unreadNotifications.data} unread` : ''}`}><Bell size={18} />{(unreadNotifications.data ?? 0) > 0 && <i />}</button><div className="user-avatar user-avatar-small">{initials}</div></div></header>
        {activeSection === 'settings'
          ? <section className="page-content settings-content"><PageHeading eyebrow="YOUR BUSINESS" title="Shop settings" description="Keep your shop details up to date. These details appear on receipts and your digital menu." /><div className="settings-card"><div className="settings-card-head"><div className="settings-icon"><Store size={18} /></div><div><h3>Business details</h3><p>Your shop identity and contact information</p></div>{canManageShop && <button className="button button-secondary button-small" onClick={() => setEditing((value) => !value)}>{editing ? 'Cancel' : 'Edit details'}</button>}</div><form className="settings-form" onSubmit={shopForm.handleSubmit((values) => saveShop.mutate(values))}><div className="form-grid"><FormField label="Shop name" error={shopForm.formState.errors.name?.message}><input readOnly={!editing} {...shopForm.register('name')} /></FormField><FormField label="Shop email" error={shopForm.formState.errors.email?.message}><input readOnly={!editing} {...shopForm.register('email')} /></FormField><FormField label="Phone number" error={shopForm.formState.errors.phone?.message}><input readOnly={!editing} {...shopForm.register('phone')} /></FormField><FormField label="Currency"><input readOnly value={`${shop.currency} · Indian Rupee`} /></FormField></div><FormField label="Business address" error={shopForm.formState.errors.address?.message}><input readOnly={!editing} {...shopForm.register('address')} /></FormField><div className="settings-divider" /><div className="settings-meta"><div><span>Public menu URL</span><strong>{window.location.origin}/menu/{shop.slug}</strong></div><div><span>Workspace created</span><strong>{new Date(shop.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</strong></div></div>{editing && <div className="settings-actions"><button type="button" className="button button-secondary" onClick={() => { shopForm.reset({ name: shop.name, email: shop.email ?? '', phone: shop.phone ?? '', address: shop.address ?? '' }); setEditing(false) }}>Cancel</button><button type="submit" className="button button-primary" disabled={saveShop.isPending}>{saveShop.isPending ? 'Saving…' : 'Save changes'} <Check size={16} /></button></div>}</form></div></section>
          : activeSection === 'menu'
            ? <Suspense fallback={<LoadingPage />}><MenuManagement shop={shop} /></Suspense>
            : activeSection === 'tables'
              ? <Suspense fallback={<LoadingPage />}><TableManagement shop={shop} /></Suspense>
              : activeSection === 'orders'
                ? <Suspense fallback={<LoadingPage />}><OrderManagement shop={shop} currency={shop.currency} role={role} /></Suspense>
                : activeSection === 'kitchen'
                  ? <Suspense fallback={<LoadingPage />}><KitchenDashboard shop={shop} /></Suspense>
                  : activeSection === 'notifications'
                    ? <Suspense fallback={<LoadingPage />}><NotificationsPage shop={shop} /></Suspense>
                      : activeSection === 'billing'
                        ? role === 'kitchen'
                          ? <section className="page-content"><PageHeading eyebrow="BILLING" title="Access restricted" description="Billing is available to owners, managers, and cashiers." /></section>
                          : <Suspense fallback={<LoadingPage />}><BillingManagement shop={shop} currency={shop.currency} /></Suspense>
                        : activeSection === 'inventory'
                          ? canManageShop
                            ? <Suspense fallback={<LoadingPage />}><InventoryManagement shop={shop} role={role} /></Suspense>
                            : <section className="page-content"><PageHeading eyebrow="INVENTORY" title="Access restricted" description="Inventory management is available to shop owners and managers." /></section>
                          : activeSection === 'reports'
                            ? canManageShop
                              ? <Suspense fallback={<LoadingPage />}><ReportingManagement shop={shop} /></Suspense>
                              : <section className="page-content"><PageHeading eyebrow="REPORTS" title="Access restricted" description="Reports are available to shop owners and managers." /></section>
              : <OverviewPage
                  shop={shop}
                  name={name}
                  onOpenSettings={() => { navigate('/dashboard/settings'); setEditing(false) }}
                  onOpenMenu={() => navigate('/dashboard/menu')}
                  onOpenTables={() => navigate('/dashboard/tables')}
                  onOpenOrders={() => navigate('/dashboard/orders')}
                />}
      </main>
    </div>
  )
}

interface DashboardOverviewData {
  summary: {
    payments_today: number
    orders_today: number
    active_tables: number
    team_members: number
  }
  payments_by_day: Array<{ date: string; amount: number }>
  setup: {
    has_menu: boolean
    has_tables: boolean
    has_team: boolean
    has_orders: boolean
  }
  recent_orders: Array<{
    id: string
    order_number: number
    status: string
    total: number
    created_at: string
    table_number: string | null
  }>
}

function dashboardMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
      notation: Math.abs(value) >= 100000 ? 'compact' : 'standard',
    }).format(value)
  } catch {
    return `${currency} ${Math.round(value).toLocaleString('en-IN')}`
  }
}

function DashboardDate({ date, weekday = false }: { date: string; weekday?: boolean }) {
  const parsed = new Date(`${date}T00:00:00`)
  return <>{parsed.toLocaleDateString('en-IN', weekday ? { weekday: 'short' } : { day: 'numeric', month: 'short' })}</>
}

function OverviewPage({ shop, name, onOpenSettings, onOpenMenu, onOpenTables, onOpenOrders }: { shop: Shop; name: string; onOpenSettings: () => void; onOpenMenu: () => void; onOpenTables: () => void; onOpenOrders: () => void }) {
  const firstName = name.split(/\s+/)[0]
  const overviewQuery = useQuery({
    queryKey: ['shop-dashboard-overview', shop.id],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { data, error } = await supabase.rpc('get_shop_dashboard_overview', {
        target_shop_id: shop.id,
        timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      })
      if (error) throw error
      if (!data || typeof data !== 'object') throw new Error('The shop overview returned an invalid response.')
      return data as DashboardOverviewData
    },
    refetchInterval: 60_000,
  })
  const overview = overviewQuery.data
  const setup = overview?.setup
  const completedSteps = overview ? 1 + Number(setup?.has_menu) + Number(setup?.has_tables) + Number(setup?.has_orders) : 0
  const steps = [
    { done: true, title: 'Create your workspace', detail: shop.name, onClick: onOpenSettings, icon: Check },
    { done: Boolean(setup?.has_menu), title: 'Add your menu', detail: setup?.has_menu ? 'Products are ready for customers' : 'Add products and prices', onClick: onOpenMenu, icon: BookOpen },
    { done: Boolean(setup?.has_tables), title: 'Add your tables', detail: setup?.has_tables ? 'Table QR codes are ready' : 'Create tables and print QR codes', onClick: onOpenTables, icon: Table2 },
    { done: Boolean(setup?.has_orders), title: 'Receive your first order', detail: setup?.has_orders ? 'Your team is taking orders' : 'Share your menu or table QR code', onClick: onOpenOrders, icon: ShoppingBasket },
  ]
  const payments = overview?.payments_by_day ?? []
  const maxPayment = Math.max(0, ...payments.map((day) => Number(day.amount)))
  const rawChartStep = maxPayment > 0 ? maxPayment / 4 : 1
  const chartMagnitude = 10 ** Math.floor(Math.log10(rawChartStep))
  const chartMax = Math.ceil(rawChartStep / chartMagnitude) * chartMagnitude * 4
  const chartPoints = payments.map((day, index) => ({
    ...day,
    x: payments.length > 1 ? (index / (payments.length - 1)) * 640 : 320,
    y: 166 - (Number(day.amount) / chartMax) * 148,
  }))
  const chartPath = chartPoints.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'
  const setupComplete = completedSteps === steps.length
  const continueSetup = !setup?.has_menu ? onOpenMenu : !setup.has_tables ? onOpenTables : onOpenOrders

  return (
    <section className="page-content">
      <div className="welcome-row">
        <PageHeading eyebrow={new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()} title={`${greeting}, ${firstName}.`} description="Here’s your shop at a glance." />
        <button className="button button-primary" onClick={setupComplete ? onOpenOrders : continueSetup}>
          <Settings size={16} /> {setupComplete ? 'View orders' : 'Continue setup'} <ArrowRight size={15} />
        </button>
      </div>
      <div className={`setup-banner ${setupComplete ? 'setup-banner-complete' : ''}`}>
        <div className="banner-symbol">{setupComplete ? <Check size={22} /> : <Leaf size={22} />}</div>
        <div className="banner-copy">
          <strong>{setupComplete ? 'Your shop is ready to serve.' : 'Get your shop ready for its first order.'}</strong>
          <span>{setupComplete ? 'Your menu and table ordering are set up.' : 'Add your menu and tables to start taking orders from a QR code.'}</span>
        </div>
        <div className="banner-progress">
          <span>{setupComplete ? 'Setup complete' : 'Getting started'}</span>
          <div className="progress-track"><i style={{ width: `${(completedSteps / steps.length) * 100}%` }} /></div>
          <small>{overviewQuery.isLoading ? 'Loading setup status…' : `${completedSteps} of ${steps.length} steps`}</small>
        </div>
        <ArrowRight size={17} className="banner-arrow" />
      </div>
      {overviewQuery.isError && <div className="overview-query-error" role="alert">Shop overview could not be loaded. Check your connection and confirm the latest Supabase migration has been applied.</div>}
      <div className="metric-grid">
        <MetricCard label="Payments today" value={overview ? dashboardMoney(Number(overview.summary.payments_today), shop.currency) : '—'} change={overviewQuery.isLoading ? 'Loading payment activity…' : 'Recorded customer payments'} icon={CreditCard} iconTone="green" />
        <MetricCard label="Orders today" value={overview ? Number(overview.summary.orders_today).toLocaleString('en-IN') : '—'} change="Non-cancelled orders placed today" icon={ShoppingBasket} iconTone="blue" />
        <MetricCard label="Active tables" value={overview ? Number(overview.summary.active_tables).toLocaleString('en-IN') : '—'} change="Tables available for service" icon={Table2} iconTone="amber" />
        <MetricCard label="Team members" value={overview ? Number(overview.summary.team_members).toLocaleString('en-IN') : '—'} change="People in this shop workspace" icon={Users} iconTone="purple" />
      </div>
      <div className="content-grid">
        <div className="panel activity-panel">
          <div className="panel-header">
            <div><h3>Payments received</h3><p>Customer payments collected over the last 7 days.</p></div>
            <span className="select-button">Last 7 days</span>
          </div>
          <div className="chart-placeholder">
            <div className="chart-y-labels">{[4, 3, 2, 1, 0].map((step) => <span key={step}>{dashboardMoney((chartMax / 4) * step, shop.currency)}</span>)}</div>
            <div className="chart-area">
              <div className="chart-gridlines"><i /><i /><i /><i /><i /></div>
              {chartPoints.length > 0 && <svg viewBox="0 0 640 190" preserveAspectRatio="none" aria-label="Payments received over the last seven days">
                <path d={chartPath} fill="none" stroke="#43885a" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                {chartPoints.map((point) => <circle key={point.date} cx={point.x} cy={point.y} r="4" fill="#43885a"><title>{`${point.date}: ${dashboardMoney(Number(point.amount), shop.currency)}`}</title></circle>)}
              </svg>}
              {overviewQuery.isLoading && <div className="chart-empty"><strong>Loading payment activity…</strong></div>}
              {!overviewQuery.isLoading && !overviewQuery.isError && maxPayment === 0 && <div className="chart-empty"><span className="chart-empty-icon"><FileText size={17} /></span><strong>No payments recorded yet</strong><small>Payments you record will appear here.</small></div>}
              <div className="chart-x-labels">{payments.map((day) => <span key={day.date}><DashboardDate date={day.date} weekday /></span>)}</div>
            </div>
          </div>
        </div>
        <div className="panel quickstart-panel">
          <div className="panel-header"><div><h3>Quick start</h3><p>Set up your shop for customer orders</p></div><span className="round-count">{completedSteps}/{steps.length}</span></div>
          <div className="quicksteps">{steps.map(({ done, title, detail, onClick, icon: Icon }) => (
            <button key={title} className={`quickstep ${done ? 'quickstep-done' : ''}`} onClick={onClick}>
              <span className="step-icon"><Icon size={15} /></span>
              <span><strong>{title}</strong><small>{done ? `Done · ${detail}` : detail}</small></span>
              {!done && <ArrowRight size={15} />}
            </button>
          ))}</div>
        </div>
      </div>
      <div className="lower-grid">
        <div className="panel empty-orders"><div className="panel-header"><div><h3>Recent orders</h3><p>Latest activity from your customers</p></div><button className="quiet-link" onClick={onOpenOrders}>View all <ArrowRight size={14} /></button></div>
          {overviewQuery.isLoading ? <div className="empty-state">Loading recent orders…</div>
            : overview?.recent_orders.length ? <div className="dashboard-recent-orders">{overview.recent_orders.map((order) => (
              <button className="dashboard-recent-order" key={order.id} onClick={onOpenOrders}>
                <span className="dashboard-order-number">#{order.order_number}</span>
                <span className="dashboard-order-info"><strong>{order.table_number ? `Table ${order.table_number}` : 'Pickup order'}</strong><small>{new Date(order.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</small></span>
                <span className={`dashboard-order-status order-status-${order.status}`}>{order.status.replace('_', ' ')}</span>
                <strong className="dashboard-order-total">{dashboardMoney(Number(order.total), shop.currency)}</strong>
              </button>
            ))}</div>
              : <div className="empty-state"><div className="empty-art"><ShoppingBasket size={24} /></div><strong>No orders just yet</strong><span>Your first order will appear here once your digital menu is live.</span></div>}
        </div>
        <div className="panel shop-preview"><div className="panel-header"><div><h3>Your shop</h3><p>Quick look at your public profile</p></div><button className="quiet-link" onClick={onOpenSettings}>Edit <ArrowRight size={14} /></button></div><div className="shop-preview-card"><div className="preview-cover"><div className="preview-logo"><Leaf size={23} /></div><span className="preview-open"><span className="live-dot" /> {setupComplete ? 'Ready for orders' : 'Setup in progress'}</span></div><div className="preview-info"><strong>{shop.name}</strong><span><Store size={14} /> {shop.address || 'Add your address in settings'}</span><span><Clock3 size={14} /> Opening hours not set</span><div className="preview-tags"><span>Digital menu</span><span>QR ordering</span></div></div></div></div>
      </div>
    </section>
  )
}

function MetricCard({ label, value, change, icon: Icon, iconTone }: { label: string; value: string; change: string; icon: typeof CreditCard; iconTone: string }) {
  return <div className="metric-card"><div className={`metric-icon ${iconTone}`}><Icon size={18} /></div><div className="metric-label">{label}</div><strong>{value}</strong><span className="metric-note">{change}</span></div>
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-heading"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
}

function FormField({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <label className="form-field"><span>{label}</span>{children}{error && <small className="field-error">{error}</small>}</label>
}

function LoadingPage() {
  return <main className="loading-page"><div className="loading-mark"><Leaf size={22} /></div><span>Getting your workspace ready…</span></main>
}

export default App
