import { Link } from 'react-router-dom'
import { ArrowLeft, ShieldCheck } from 'lucide-react'

const termsSections = [
  {
    title: 'About PressPilot',
    paragraphs: [
      'PressPilot provides tools for shop accounts to manage menus, products, orders, tables, inventory, and related business records, as well as public pages where customers can browse a shop menu and submit an order.',
      'The shop, not PressPilot, prepares and sells the food and drinks, sets its prices and availability, and handles customer questions, fulfillment, refunds, and payment.',
    ],
  },
  {
    title: 'Using a shop menu and placing an order',
    paragraphs: [
      'You may browse a shop’s public menu without creating a PressPilot account. When placing an order, provide accurate information if you choose to enter a name, phone number, or note. Order notes should be limited to relevant instructions and should not include sensitive personal information.',
      'Submitting an order sends the selected items, options, and any information you provided to that shop. The shop must confirm and fulfill the order. Contact the shop directly about changes, cancellations, availability, preparation, allergens, or refunds; the customer ordering page does not provide an order-cancellation function.',
      'Prices and taxes shown before submission may be estimates. The shop confirms the applicable total and any payment due. Public ordering through PressPilot does not itself collect card payment; table orders direct customers to settle the bill with shop staff.',
      'A shop may offer optional visit rewards. Visit counts are based on completed orders associated with the phone number you provide and are not phone-verified. Ask the shop team about reward availability and redemption.',
    ],
  },
  {
    title: 'Shop accounts and responsibilities',
    paragraphs: [
      'Shop owners and authorized staff must provide accurate account and business information, keep their sign-in credentials private, and use only the workspace access assigned to them. Workspace owners are responsible for managing staff access.',
      'Shops are responsible for the accuracy and legality of their menus, prices, availability, product descriptions, allergen and dietary information, branding, customer communications, and compliance with requirements applicable to their business.',
    ],
  },
  {
    title: 'Content and acceptable use',
    paragraphs: [
      'You must have the rights and permissions needed to upload or publish shop names, logos, cover images, product photos, and other content. Public menu content and images may be visible to anyone with access to the menu link.',
      'Do not misuse the service, attempt unauthorized access, interfere with its operation, submit unlawful or misleading content, or use another person’s account without permission.',
    ],
  },
  {
    title: 'Availability and changes',
    paragraphs: [
      'We work to keep PressPilot available and reliable, but do not guarantee uninterrupted access, error-free operation, or that a shop will accept or fulfill a particular order. Features may change as the service develops.',
      'We may suspend or restrict access where reasonably necessary to protect the service, its users, or a shop workspace, including in response to suspected misuse or security concerns.',
    ],
  },
  {
    title: 'Third-party services and privacy',
    paragraphs: [
      'PressPilot relies on service providers to support authentication, data storage, and delivery of the website. Your use of those services may also be subject to their own terms.',
      'Our privacy policy explains how account, shop, and order information is handled. By using PressPilot, you acknowledge that policy.',
    ],
  },
  {
    title: 'Changes to these terms',
    paragraphs: [
      'We may update these terms as PressPilot changes. The date at the top indicates when this page was last revised. Continued use of the service after an update means you accept the revised terms.',
    ],
  },
]

export function TermsAndConditionsPage() {
  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Link className="privacy-wordmark" to="/login">PressPilot</Link>
        <Link className="privacy-back-link" to="/login"><ArrowLeft size={15} /> Back to sign in</Link>
      </header>
      <div className="privacy-content">
        <div className="privacy-intro">
          <span className="privacy-icon"><ShieldCheck size={20} /></span>
          <p className="eyebrow">USING PRESSPILOT</p>
          <h1>Terms and conditions</h1>
          <p className="privacy-lede">Terms for shop teams using PressPilot and customers ordering from a shop’s public menu.</p>
          <span className="privacy-updated">Last updated November 21, 2026</span>
        </div>
        <div className="privacy-sections">
          {termsSections.map((section, index) => (
            <section className="privacy-section" key={section.title}>
              <span className="privacy-section-number">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h2>{section.title}</h2>
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </section>
          ))}
        </div>
        <p className="privacy-contact"><Link to="/privacy">Read our privacy policy</Link></p>
      </div>
      <footer className="privacy-footer">© 2026 PressPilot <span>·</span> Made for independent shops</footer>
    </main>
  )
}
