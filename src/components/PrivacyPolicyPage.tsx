import { Link } from 'react-router-dom'
import { ArrowLeft, ShieldCheck } from 'lucide-react'

const policySections = [
  {
    title: 'Information we handle',
    paragraphs: [
      'When a shop creates an account, PressPilot processes account details such as the email address and profile name associated with that account. Shop owners and staff may also add business details, team roles, menu items, prices, product photos, a shop logo, and a promotional cover image.',
      'When you place an order from a public menu, the shop receives the order items and customizations, table selection when applicable, order total, and any name, phone number, or note you choose to provide. Name and phone are optional in the ordering form. Please do not include sensitive personal information in order notes.',
      'The ordering page saves your cart in your browser, associated with that shop and table selection, so it remains available while you browse. The cart is removed after a successful order; you can also clear it by clearing this site’s browser storage.',
    ],
  },
  {
    title: 'How information is used',
    paragraphs: [
      'We use this information to authenticate shop accounts, provide shop and menu management, send customer orders to the correct shop, support table-based ordering, display order status to shop staff, and maintain the security and operation of the service.',
      'Payment details are not requested in the public ordering form. Shops may record billing and payment status in their workspace; payment is arranged directly with the shop.',
    ],
  },
  {
    title: 'Who can see information',
    paragraphs: [
      'Order details are available to authorized members of the shop that received the order. Platform administrators may access limited shop and operational information to administer the service.',
      'Public menus, shop contact details, shop logos and cover images, and product details and images are intended to be visible to anyone who can access the menu link. Do not upload information that should remain private.',
    ],
  },
  {
    title: 'Service providers',
    paragraphs: [
      'PressPilot uses Supabase for account authentication, database services, and image storage. The website also loads the Plus Jakarta Sans typeface from Google Fonts. These providers process technical information needed to deliver their services and are subject to their own privacy terms.',
    ],
  },
  {
    title: 'Retention and your choices',
    paragraphs: [
      'Shop order and business records remain available to the shop for its operations and recordkeeping. Retention periods may depend on the shop’s practices and legal obligations. Cart data is stored in your browser until an order is submitted or you clear the site’s browser storage.',
      'For questions about an order or requests to access, correct, or delete order information, contact the shop using the contact details on its menu. For a PressPilot account, contact your shop or workspace administrator. Requests may be subject to applicable recordkeeping requirements.',
    ],
  },
  {
    title: 'Security and updates',
    paragraphs: [
      'Access to shop workspaces is controlled by account authentication and assigned staff roles. No online service can guarantee absolute security, so please keep your sign-in details private and contact your workspace administrator if you suspect unauthorized access.',
      'We may update this policy as the service changes. The date at the top indicates when this page was last revised.',
    ],
  },
]

export function PrivacyPolicyPage() {
  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Link className="privacy-wordmark" to="/login">PressPilot</Link>
        <Link className="privacy-back-link" to="/login"><ArrowLeft size={15} /> Back to sign in</Link>
      </header>
      <div className="privacy-content">
        <div className="privacy-intro">
          <span className="privacy-icon"><ShieldCheck size={20} /></span>
          <p className="eyebrow">YOUR PRIVACY</p>
          <h1>Privacy policy</h1>
          <p className="privacy-lede">How PressPilot handles shop account details, customer orders, and menu information.</p>
          <span className="privacy-updated">Last updated November 19, 2026</span>
        </div>
        <div className="privacy-sections">
          {policySections.map((section, index) => (
            <section className="privacy-section" key={section.title}>
              <span className="privacy-section-number">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h2>{section.title}</h2>
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}
        </div>
        <p className="privacy-contact">Questions about an order? Contact the shop using the details shown on its public menu. <Link to="/terms">Read our terms and conditions.</Link></p>
      </div>
      <footer className="privacy-footer">© 2026 PressPilot <span>·</span> Made for independent shops</footer>
    </main>
  )
}
