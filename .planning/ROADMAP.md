# Roadmap: Baseworks

## Milestones

- ✅ **v1.0 MVP** -- Phases 1-5 (shipped 2026-04-08)
- 🚧 **v1.1 Polish & Extensibility** -- Phases 6-10 (in progress)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-5) -- SHIPPED 2026-04-08</summary>

- [x] Phase 1: Foundation & Core Infrastructure (3/3 plans) -- completed 2026-04-06
- [x] Phase 2: Auth & Multitenancy (3/3 plans) -- completed 2026-04-06
- [x] Phase 3: Billing & Background Jobs (4/4 plans) -- completed 2026-04-07
- [x] Phase 4: Frontend Applications (3/3 plans) -- completed 2026-04-07
- [x] Phase 5: Production Hardening (2/2 plans) -- completed 2026-04-08

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

### v1.1 Polish & Extensibility

- [ ] **Phase 6: Responsive Layouts** - Fix sidebar overlay and make both frontends fully responsive across mobile, tablet, and desktop
- [ ] **Phase 7: Accessibility** - Keyboard navigation, screen reader support, semantic HTML, and automated a11y testing across both apps
- [ ] **Phase 8: Internationalization** - Shared i18n package with pt-BR and en translations wired into both frontends
- [ ] **Phase 9: Team Invites** - Invite-by-email, invite links, role assignment, accept/decline flow with translated UI
- [ ] **Phase 10: Payment Abstraction** - Port/adapter interface, Stripe adapter extraction, Brazilian provider adapter, webhook normalization

## Phase Details

### Phase 6: Responsive Layouts
**Goal**: Users on any device see a usable, properly laid-out interface with no content hidden behind sidebars or broken by viewport size
**Depends on**: Phase 5 (v1.0 complete)
**Requirements**: RESP-01, RESP-02, RESP-03, RESP-04, RESP-05, RESP-06
**Success Criteria** (what must be TRUE):
  1. User on desktop sees the sidebar alongside page content with no overlay or content obstruction
  2. User on mobile can open and close the sidebar via hamburger menu, seeing a Sheet drawer that dismisses on navigation
  3. User on tablet sees a collapsible icon-only sidebar that expands on interaction
  4. User can browse data tables on mobile via a card-based layout without horizontal scrolling
  5. All pages in both the customer app and admin dashboard render without horizontal overflow at 375px, 768px, and 1440px viewports
**Plans:** 3 plans
Plans:
- [ ] 06-01-PLAN.md — Three-tier responsive sidebar (desktop/tablet/mobile) with localStorage persistence
- [ ] 06-02-PLAN.md — Mobile card-based DataTable view with column priority metadata
- [ ] 06-03-PLAN.md — Page-level responsive audit and fixes across both apps
**UI hint**: yes

### Phase 7: Accessibility
**Goal**: Users with disabilities can navigate and operate both applications using keyboard, screen readers, and assistive technology
**Depends on**: Phase 6
**Requirements**: A11Y-01, A11Y-02, A11Y-03, A11Y-04, A11Y-05, A11Y-06
**Success Criteria** (what must be TRUE):
  1. Every page uses semantic HTML landmarks (nav, main, aside) with a correct heading hierarchy (h1 through h3, no skipped levels)
  2. User can Tab through all interactive elements on every page with a visible focus indicator, and Escape closes any open modal/sheet/dropdown
  3. User pressing Tab on page load can activate a skip-to-content link that jumps focus to the main content area
  4. Screen reader user hears meaningful announcements for toasts, loading spinners, and dynamic content changes via aria-live regions
  5. All shared UI components pass vitest-axe automated accessibility checks with zero violations
**Plans**: TBD
**UI hint**: yes

### Phase 8: Internationalization
**Goal**: Both frontends render all UI strings from shared translation files, and adding a new language requires only JSON files
**Depends on**: Phase 6
**Requirements**: I18N-01, I18N-02, I18N-03, I18N-04
**Success Criteria** (what must be TRUE):
  1. A packages/i18n workspace package exists with pt-BR and en JSON translation files organized by namespace
  2. Customer app (Next.js) renders all user-facing strings from translation files via next-intl, with no hardcoded English in JSX
  3. Admin dashboard (Vite) renders all user-facing strings from translation files via react-i18next, with no hardcoded English in JSX
  4. Developer can add a new language by creating JSON files in packages/i18n without modifying application code
**Plans**: TBD
**UI hint**: yes

### Phase 9: Team Invites
**Goal**: Organization admins can invite users to their team with role assignment, and invited users can accept via email link or shareable URL
**Depends on**: Phase 8
**Requirements**: INVT-01, INVT-02, INVT-03, INVT-04, INVT-05
**Success Criteria** (what must be TRUE):
  1. Org admin can enter an email and select a role (admin/member) to send an invitation from the tenant settings page
  2. Invited user receives an email with a link that shows organization name, inviter, role, and accept/decline buttons
  3. Org admin can generate a shareable invite link with a pre-assigned role that anyone with the link can use to join
  4. Invited user (existing or new account) can accept an invite and immediately land in the organization with the correct role
  5. Org admin can view all pending invitations and cancel or resend any invitation from a management page
**Plans**: TBD
**UI hint**: yes

### Phase 10: Payment Abstraction
**Goal**: Billing module operates through a provider-agnostic interface, with Stripe and one Brazilian provider as concrete adapters
**Depends on**: Phase 5 (v1.0 billing module)
**Requirements**: PAY-01, PAY-02, PAY-03, PAY-04, PAY-05
**Success Criteria** (what must be TRUE):
  1. A PaymentProvider port interface exists covering customer management, subscriptions, one-time payments, checkout sessions, portal sessions, and webhook verification
  2. All existing billing functionality works identically after Stripe code is refactored into a StripeAdapter implementing the PaymentProvider interface
  3. Webhook events from any provider are normalized into unified domain events (subscription.created, payment.succeeded, etc.) before processing
  4. A Brazilian payment provider adapter implements the PaymentProvider interface with support for its native payment methods
  5. Switching the active payment provider requires only changing an environment variable at startup -- no code changes
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 6 -> 7 -> 8 -> 9 -> 10

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Core Infrastructure | v1.0 | 3/3 | Complete | 2026-04-06 |
| 2. Auth & Multitenancy | v1.0 | 3/3 | Complete | 2026-04-06 |
| 3. Billing & Background Jobs | v1.0 | 4/4 | Complete | 2026-04-07 |
| 4. Frontend Applications | v1.0 | 3/3 | Complete | 2026-04-07 |
| 5. Production Hardening | v1.0 | 2/2 | Complete | 2026-04-08 |
| 6. Responsive Layouts | v1.1 | 0/3 | Planned | - |
| 7. Accessibility | v1.1 | 0/0 | Not started | - |
| 8. Internationalization | v1.1 | 0/0 | Not started | - |
| 9. Team Invites | v1.1 | 0/0 | Not started | - |
| 10. Payment Abstraction | v1.1 | 0/0 | Not started | - |
