# Freshdesk

A React and Supabase app for juice bars and small cafes. Phase 1 provides authentication, private shop onboarding, a responsive shop dashboard, and tenant-scoped data policies. Phase 2 adds category and product management, size variants and priced customization groups, image uploads, table QR codes, a public menu, a locally persisted cart, and server-validated order placement. Phase 3 adds live staff order management, a kitchen display, guarded order-status transitions, cancellation reasons, and staff notifications. Phase 4 adds invoice creation, partial and full payment recording, receipts, and table closeout. Phase 5 adds ingredient inventory, product recipes, suppliers, purchases, adjustments, and order-time stock consumption with cancellation restocking.

## Run locally

1. Install Node.js 20.19+ and create a Supabase project.
2. In the Supabase SQL Editor, run the migrations in order:
   - `supabase/migrations/202611170001_initial_schema.sql`
   - `supabase/migrations/202611180001_phase_two_menu_and_qr.sql`
   - `supabase/migrations/202611180002_phase_three_orders_and_kitchen.sql`
   - `supabase/migrations/202611180003_phase_four_billing.sql`
   - `supabase/migrations/202611180004_phase_five_inventory.sql`
3. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the Supabase project API settings.
4. Run `npm install`, then `npm run dev`.

The browser app uses only the Supabase anon key. Never add a service-role key to a `VITE_*` variable or commit local environment files. Row Level Security is enabled for every application table; shop creation and owner membership are provisioned by `create_shop`. Public menu reads expose only curated active menu fields through `get_public_menu`; customer orders are created by `place_public_order`, which reloads product and variant prices from the database before saving. Order status changes go through the role-checked `update_order_status` RPC; the migration revokes direct staff writes to orders and order items.

## Current routes

- `/login`, `/register`, `/forgot-password`
- `/onboarding`
- `/dashboard`, `/dashboard/orders`, `/dashboard/kitchen`, `/dashboard/notifications`, `/dashboard/billing`, `/dashboard/inventory`, `/dashboard/menu`, `/dashboard/tables`, and `/dashboard/settings`
- `/menu/:shopSlug` and `/menu/:shopSlug/order/:orderId`

The orders and kitchen screens subscribe to Supabase Realtime and use shop-scoped queries. Staff can progress orders through the allowed workflow and cancel eligible orders with a required reason. Billing creates invoices only for served orders, uses database-stored order prices and the configured service charge, accepts partial or full payments, and closes tables after final settlement. Inventory can be enabled per shop; mapped recipe ingredients are deducted atomically when orders are placed and restored on cancellation. Insufficient stock blocks new orders unless an owner or manager enables negative stock. Public order confirmation is intentionally not backed by public order reads; customers receive the order reference when they submit the order. Run each migration manually in Supabase, in order, before using its phase's screens. Reporting remains a future phase.
