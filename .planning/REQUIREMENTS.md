# Requirements: Baseworks

**Defined:** 2026-04-08
**Core Value:** Clone, configure, and start building a multitenant SaaS in minutes -- not weeks.

## v1.1 Requirements

Requirements for v1.1 Polish & Extensibility. Each maps to roadmap phases.

### Responsive Layouts

- [ ] **RESP-01**: User sees sidebar that doesn't overlay page content on desktop
- [ ] **RESP-02**: User can toggle sidebar via hamburger menu on mobile, sees Sheet drawer
- [ ] **RESP-03**: User sees collapsible sidebar on tablet breakpoints
- [ ] **RESP-04**: User can browse data tables on mobile via card-based layout
- [ ] **RESP-05**: User experiences fully responsive layouts on all customer app pages
- [ ] **RESP-06**: User experiences fully responsive layouts on all admin dashboard pages

### Accessibility

- [ ] **A11Y-01**: User navigates pages with proper semantic HTML landmarks (nav, main, aside, headings)
- [ ] **A11Y-02**: User can navigate all interactive elements via keyboard with visible focus indicators
- [ ] **A11Y-03**: User can use skip-to-content links on both apps
- [ ] **A11Y-04**: Screen reader user hears meaningful announcements for toasts, loading states, and dynamic content via aria-live regions
- [ ] **A11Y-05**: Screen reader user can understand all forms with proper labels, descriptions, and error announcements
- [ ] **A11Y-06**: All components pass automated vitest-axe accessibility checks

### Internationalization

- [ ] **I18N-01**: Shared i18n package (packages/i18n) with pt-BR and en JSON translation files
- [ ] **I18N-02**: Customer app (Next.js) renders all UI strings from translation files via next-intl
- [ ] **I18N-03**: Admin dashboard (Vite) renders all UI strings from translation files via react-i18next
- [ ] **I18N-04**: User can add a new language by adding JSON files without code changes

### Team Invites

- [ ] **INVT-01**: Org admin can invite a user by email with a role (admin/member)
- [ ] **INVT-02**: Invited user receives email with accept/decline link
- [ ] **INVT-03**: Org admin can generate a shareable invite link with a role
- [ ] **INVT-04**: Invited user can accept invite and join the organization (existing or new account)
- [ ] **INVT-05**: Org admin can view, cancel, and resend pending invitations from management page

### Payment Abstraction

- [ ] **PAY-01**: PaymentProvider port interface covers: createCustomer, createSubscription, cancelSubscription, changeSubscription, getSubscription, createOneTimePayment, createCheckoutSession, createPortalSession, verifyWebhookSignature
- [ ] **PAY-02**: Existing Stripe code refactored into StripeAdapter implementing PaymentProvider interface
- [ ] **PAY-03**: Webhook normalization layer translates provider-specific events into unified domain events
- [ ] **PAY-04**: Brazilian payment provider adapter implementing PaymentProvider interface (provider TBD during planning)
- [ ] **PAY-05**: Active payment provider selected via environment configuration at startup

## v1.2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Internationalization

- **I18N-05**: Locale-based URL routing (/en/dashboard, /pt-BR/dashboard) on customer app
- **I18N-06**: Language switcher UI component in both apps
- **I18N-07**: Backend i18n -- transactional emails and API errors in user's language

### Team Invites

- **INVT-06**: Configurable invite expiration with auto-cleanup

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Provider selection per tenant | Over-engineering -- one provider per deployment is sufficient for starter kit |
| Usage-based billing in payment interface | Provider-specific feature -- access via SDK directly |
| Customer portal in payment interface | Stripe-specific, no equivalent in most Brazilian providers |
| Real-time / WebSockets | Deferred from v1.0, still not needed |
| Mobile app | Web-first, responsive web covers mobile needs |
| Full event sourcing | Practical CQRS only, no projections or replay |
| Landing page / marketing site | This is a starter kit, not a finished product |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RESP-01 | Phase 6 | Pending |
| RESP-02 | Phase 6 | Pending |
| RESP-03 | Phase 6 | Pending |
| RESP-04 | Phase 6 | Pending |
| RESP-05 | Phase 6 | Pending |
| RESP-06 | Phase 6 | Pending |
| A11Y-01 | Phase 11 | Pending |
| A11Y-02 | Phase 7 | Pending |
| A11Y-03 | Phase 12 | Pending |
| A11Y-04 | Phase 11 | Pending |
| A11Y-05 | Phase 11 | Pending |
| A11Y-06 | Phase 7 | Pending |
| I18N-01 | Phase 12 | Pending |
| I18N-02 | Phase 12 | Pending |
| I18N-03 | Phase 12 | Pending |
| I18N-04 | Phase 12 | Pending |
| INVT-01 | Phase 9 | Pending |
| INVT-02 | Phase 12 | Pending |
| INVT-03 | Phase 9 | Pending |
| INVT-04 | Phase 9 | Pending |
| INVT-05 | Phase 9 | Pending |
| PAY-01 | Phase 10 | Pending |
| PAY-02 | Phase 10 | Pending |
| PAY-03 | Phase 10 | Pending |
| PAY-04 | Phase 10 | Pending |
| PAY-05 | Phase 10 | Pending |

**Coverage:**
- v1.1 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0

---
*Requirements defined: 2026-04-08*
*Last updated: 2026-04-13 after v1.1 milestone audit gap closure phases (11, 12) added*
