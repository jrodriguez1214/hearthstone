// ============================================================
//  HEARTHSTONE — Property Manager  |  app.js
// ============================================================

// --- Utilities ---

const uuid = () => crypto.randomUUID()
const $  = id => document.getElementById(id)

const fmt = {
  currency: n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  date: s => {
    if (!s) return '—'
    const d = new Date(s + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  },
  monthLabel: s => {
    if (!s) return '—'
    const [y, m] = s.split('-')
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }
}

const today       = () => new Date().toISOString().split('T')[0]
const thisMonth   = () => today().slice(0, 7)
const capitalize  = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : ''

function esc(s) {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// --- Storage ---

const KEYS = {
  properties:  'hs_properties',
  tenants:     'hs_tenants',
  payments:    'hs_payments',
  outstanding: 'hs_outstanding',
  repairs:     'hs_repairs',
  expenses:    'hs_expenses',
  seeded:      'hs_seeded'
}

const Store = {
  get:    key        => JSON.parse(localStorage.getItem(key) || '[]'),
  set:    (key, val) => localStorage.setItem(key, JSON.stringify(val)),
  add:    (key, item) => { const a = Store.get(key); a.push(item); Store.set(key, a); return item },
  update: (key, id, patch) => Store.set(key, Store.get(key).map(x => x.id === id ? { ...x, ...patch } : x)),
  remove: (key, id)  => Store.set(key, Store.get(key).filter(x => x.id !== id)),
  find:   (key, id)  => Store.get(key).find(x => x.id === id),
  where:  (key, f, v)=> Store.get(key).filter(x => x[f] === v),
}

// --- Seed Data ---

function seed() {
  if (localStorage.getItem(KEYS.seeded)) return

  const p1 = { id: uuid(), name: 'Maple Avenue House',   address: '142 Maple Ave, Austin, TX 78701',        type: 'house',     bedrooms: 3, bathrooms: 2,   monthlyRent: 2400, status: 'occupied', notes: '', createdAt: '2024-01-15' }
  const p2 = { id: uuid(), name: 'Riverside Condo',      address: '88 Riverside Dr #4B, Austin, TX 78702',  type: 'condo',     bedrooms: 2, bathrooms: 1,   monthlyRent: 1800, status: 'occupied', notes: '', createdAt: '2024-03-01' }
  const p3 = { id: uuid(), name: 'Cedar Hill Duplex',    address: '310 Cedar Hill Rd, Austin, TX 78703',    type: 'house',     bedrooms: 4, bathrooms: 2.5, monthlyRent: 2900, status: 'vacant',   notes: 'Recently renovated kitchen', createdAt: '2024-06-10' }
  Store.set(KEYS.properties, [p1, p2, p3])

  const t1 = { id: uuid(), propertyId: p1.id, firstName: 'Marcus',  lastName: 'Rivera', email: 'marcus.r@email.com',  phone: '(512) 555-0142', leaseStart: '2024-02-01', leaseEnd: '2025-01-31', rentAmount: 2400, depositAmount: 2400, depositPaid: true,  status: 'active', notes: '', createdAt: '2024-01-20' }
  const t2 = { id: uuid(), propertyId: p2.id, firstName: 'Priya',   lastName: 'Nair',   email: 'priya.nair@email.com', phone: '(512) 555-0198', leaseStart: '2024-03-15', leaseEnd: '2025-03-14', rentAmount: 1800, depositAmount: 1800, depositPaid: true,  status: 'active', notes: '', createdAt: '2024-03-10' }
  Store.set(KEYS.tenants, [t1, t2])

  const pmts = []
  ;['2025-01','2025-02','2025-03'].forEach(m => {
    pmts.push({ id: uuid(), propertyId: p1.id, tenantId: t1.id, amount: 2400, month: m, dueDate: m+'-01', paidDate: m+'-02', status: 'paid',    method: 'bank transfer', notes: '', createdAt: m+'-01' })
    pmts.push({ id: uuid(), propertyId: p2.id, tenantId: t2.id, amount: 1800, month: m, dueDate: m+'-01', paidDate: m+'-04', status: 'paid',    method: 'zelle',         notes: '', createdAt: m+'-01' })
  })
  pmts.push({ id: uuid(), propertyId: p1.id, tenantId: t1.id, amount: 2400, month: '2025-04', dueDate: '2025-04-01', paidDate: '',           status: 'pending', method: '',              notes: '', createdAt: '2025-04-01' })
  pmts.push({ id: uuid(), propertyId: p2.id, tenantId: t2.id, amount: 1800, month: '2025-04', dueDate: '2025-04-01', paidDate: '',           status: 'late',    method: '',              notes: '', createdAt: '2025-04-01' })
  Store.set(KEYS.payments, pmts)

  Store.set(KEYS.outstanding, [
    { id: uuid(), propertyId: p1.id, title: 'Replace kitchen faucet',        description: 'Tenant reported slow drip, needs new faucet.',    priority: 'medium', status: 'open',        dueDate: '2025-04-20', createdAt: '2025-04-02', resolvedAt: '' },
    { id: uuid(), propertyId: p2.id, title: 'Annual HVAC inspection',        description: 'Schedule yearly service before summer heat.',      priority: 'low',    status: 'in-progress', dueDate: '2025-05-01', createdAt: '2025-03-15', resolvedAt: '' },
    { id: uuid(), propertyId: p3.id, title: 'Deep clean before new tenant',  description: 'Full property clean and touch-up before listing.', priority: 'high',   status: 'open',        dueDate: '2025-04-15', createdAt: '2025-04-01', resolvedAt: '' },
  ])

  Store.set(KEYS.repairs, [
    { id: uuid(), propertyId: p1.id, title: 'Broken back fence panel',        description: 'Storm damage to rear yard fence.',          vendor: 'Austin Fence Co.',  estimatedCost: 350, actualCost: 320, status: 'completed', reportedDate: '2025-02-10', completedDate: '2025-02-18', notes: '', createdAt: '2025-02-10' },
    { id: uuid(), propertyId: p2.id, title: 'Bathroom exhaust fan replacement', description: 'Fan stopped working, moisture buildup.',  vendor: '',                  estimatedCost: 150, actualCost: 0,   status: 'scheduled', reportedDate: '2025-03-28', completedDate: '',           notes: 'Appointment scheduled for Apr 12', createdAt: '2025-03-28' },
  ])

  Store.set(KEYS.expenses, [
    { id: uuid(), propertyId: p1.id, category: 'insurance',    description: 'Annual homeowner insurance renewal',      amount: 1440, date: '2025-01-10', notes: '', createdAt: '2025-01-10' },
    { id: uuid(), propertyId: p2.id, category: 'maintenance',  description: 'Pest control — quarterly service',        amount:  120, date: '2025-02-05', notes: '', createdAt: '2025-02-05' },
    { id: uuid(), propertyId: p3.id, category: 'repairs',      description: 'Kitchen renovation — granite countertops', amount: 3200, date: '2025-03-20', notes: 'Part of pre-listing renovation', createdAt: '2025-03-20' },
    { id: uuid(), propertyId: p1.id, category: 'maintenance',  description: 'Lawn care — spring cleanup',              amount:   85, date: '2025-04-01', notes: '', createdAt: '2025-04-01' },
  ])

  localStorage.setItem(KEYS.seeded, '1')
}

// --- Modal ---

const Modal = {
  open(title, bodyHTML, onSubmit) {
    $('modal-title').textContent = title
    $('modal-body').innerHTML = bodyHTML
    $('modal-overlay').classList.remove('hidden')
    document.body.style.overflow = 'hidden'
    if (onSubmit) {
      const form = $('modal-body').querySelector('form')
      if (form) form.addEventListener('submit', e => { e.preventDefault(); onSubmit(form) })
    }
  },
  close() {
    $('modal-overlay').classList.add('hidden')
    $('modal-title').textContent = ''
    $('modal-body').innerHTML = ''
    document.body.style.overflow = ''
  }
}

// --- More Tray (mobile) ---

const MoreTray = {
  open() {
    $('more-tray').classList.remove('hidden')
    document.body.style.overflow = 'hidden'
    // Highlight active more-tray item
    const morePages = ['outstanding', 'repairs', 'expenses']
    document.querySelectorAll('.more-tray-item').forEach(el =>
      el.classList.toggle('active', el.dataset.page === activePage)
    )
  },
  close() {
    $('more-tray').classList.add('hidden')
    document.body.style.overflow = ''
  },
  toggle() {
    if ($('more-tray').classList.contains('hidden')) this.open()
    else this.close()
  }
}

// --- Router ---

const PAGE_TITLES = {
  dashboard:   'Dashboard',
  properties:  'Properties',
  tenants:     'Tenants',
  payments:    'Payments',
  outstanding: 'Outstanding',
  repairs:     'Repairs',
  expenses:    'Expenses',
}

const MORE_PAGES = ['outstanding', 'repairs', 'expenses']

let activePage = 'dashboard'

const Router = {
  go(page) {
    activePage = page
    MoreTray.close()

    // Desktop sidebar
    document.querySelectorAll('.nav-item[data-page]').forEach(el =>
      el.classList.toggle('active', el.dataset.page === page)
    )

    // Mobile bottom tabs
    document.querySelectorAll('.tab-item[data-page]').forEach(el =>
      el.classList.toggle('active', el.dataset.page === page)
    )
    // "More" tab stays active when on a more-page
    const moreTab = $('more-tab')
    if (moreTab) moreTab.classList.toggle('active', MORE_PAGES.includes(page))

    // Mobile header title
    const titleEl = $('mobile-page-title')
    if (titleEl) titleEl.textContent = PAGE_TITLES[page] || page

    // Scroll content to top
    const ca = document.querySelector('.content-area')
    if (ca) ca.scrollTop = 0

    Pages[page].render()
  }
}

// --- Shared helpers ---

function propOptions(selectedId = '', includeAll = false) {
  const props = Store.get(KEYS.properties)
  const placeholder = includeAll
    ? `<option value="">All Properties</option>`
    : `<option value="">Select a property</option>`
  return placeholder + props.map(p =>
    `<option value="${p.id}"${p.id === selectedId ? ' selected' : ''}>${esc(p.name)}</option>`
  ).join('')
}

function tenantOptions(propertyId = '', selectedId = '') {
  const all = Store.get(KEYS.tenants)
  const tenants = propertyId ? all.filter(t => t.propertyId === propertyId) : all
  return `<option value="">— none —</option>` + tenants.map(t =>
    `<option value="${t.id}"${t.id === selectedId ? ' selected' : ''}>${esc(t.firstName)} ${esc(t.lastName)}</option>`
  ).join('')
}

function propName(id) { const p = Store.find(KEYS.properties, id); return p ? esc(p.name) : '—' }
function tenantName(id) { const t = Store.find(KEYS.tenants, id); return t ? `${esc(t.firstName)} ${esc(t.lastName)}` : '—' }

function badge(status) {
  const map = {
    occupied: ['badge-green',  'Occupied'],  vacant:      ['badge-amber',  'Vacant'],
    active:   ['badge-green',  'Active'],    former:      ['badge-gray',   'Former'],
    paid:     ['badge-green',  'Paid'],      pending:     ['badge-amber',  'Pending'],    late:        ['badge-red',    'Late'],
    open:     ['badge-red',    'Open'],      'in-progress':['badge-blue',  'In Progress'], resolved:   ['badge-green',  'Resolved'],
    reported: ['badge-orange', 'Reported'],  scheduled:   ['badge-blue',   'Scheduled'],  completed:  ['badge-green',  'Completed'],
  }
  const [cls, label] = map[status] || ['badge-gray', capitalize(status)]
  return `<span class="badge ${cls}">${label}</span>`
}

function priorityBadge(p) {
  const map = { high: ['badge-red','High'], medium: ['badge-amber','Medium'], low: ['badge-green','Low'] }
  const [cls, label] = map[p] || ['badge-gray', p]
  return `<span class="badge ${cls}">${label}</span>`
}

// ============================================================
//  Pages
// ============================================================

const Pages = {}

// ── DASHBOARD ──────────────────────────────────────────────

Pages.dashboard = {
  render() {
    const props    = Store.get(KEYS.properties)
    const tenants  = Store.get(KEYS.tenants).filter(t => t.status === 'active')
    const payments = Store.get(KEYS.payments)
    const open     = Store.get(KEYS.outstanding).filter(o => o.status !== 'resolved')
    const repairs  = Store.get(KEYS.repairs)

    const mon       = thisMonth()
    const monPmts   = payments.filter(p => p.month === mon)
    const collected = monPmts.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0)
    const expected  = tenants.reduce((s, t) => s + Number(t.rentAmount), 0)
    const vacant    = props.filter(p => p.status === 'vacant').length
    const activeRep = repairs.filter(r => r.status !== 'completed').length

    const recentPmts = [...payments].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)

    $('page-root').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">Dashboard</div>
          <div class="page-subtitle">Here's your property overview at a glance.</div>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card accent">
          <div class="stat-label">Properties</div>
          <div class="stat-value">${props.length}</div>
          <div class="stat-meta">${vacant} vacant</div>
        </div>
        <div class="stat-card blue">
          <div class="stat-label">Active Tenants</div>
          <div class="stat-value">${tenants.length}</div>
          <div class="stat-meta">across ${props.length} propert${props.length !== 1 ? 'ies' : 'y'}</div>
        </div>
        <div class="stat-card accent">
          <div class="stat-label">Collected This Month</div>
          <div class="stat-value" style="font-size:20px;padding-top:4px">${fmt.currency(collected)}</div>
          <div class="stat-meta">of ${fmt.currency(expected)} expected</div>
        </div>
        <div class="stat-card ${open.length > 0 ? 'amber' : 'accent'}">
          <div class="stat-label">Open Items</div>
          <div class="stat-value">${open.length}</div>
          <div class="stat-meta">${activeRep} active repair${activeRep !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <div class="dashboard-grid">

        <div class="dash-panel">
          <div class="panel-head">
            <span class="panel-head-title">Recent Payments</span>
            <button class="btn btn-secondary btn-sm" onclick="Router.go('payments')">View all</button>
          </div>
          ${recentPmts.length ? recentPmts.map(p => `
            <div class="panel-row">
              <div>
                <div class="panel-row-label">${tenantName(p.tenantId)}</div>
                <div class="panel-row-sub">${propName(p.propertyId)} &middot; ${fmt.monthLabel(p.month)}</div>
              </div>
              <div style="text-align:right">
                <div style="font-weight:600;font-size:13px">${fmt.currency(p.amount)}</div>
                <div style="margin-top:3px">${badge(p.status)}</div>
              </div>
            </div>
          `).join('') : `<div class="panel-empty">No payments recorded yet.</div>`}
        </div>

        <div class="dash-panel">
          <div class="panel-head">
            <span class="panel-head-title">Open Items</span>
            <button class="btn btn-secondary btn-sm" onclick="Router.go('outstanding')">View all</button>
          </div>
          ${open.length ? open.slice(0, 5).map(o => `
            <div class="panel-row">
              <div>
                <div class="panel-row-label">${esc(o.title)}</div>
                <div class="panel-row-sub">${propName(o.propertyId)}</div>
              </div>
              <div style="text-align:right">
                ${priorityBadge(o.priority)}
                <div style="margin-top:3px">${badge(o.status)}</div>
              </div>
            </div>
          `).join('') : `<div class="panel-empty">No open items — great work!</div>`}
        </div>

        <div class="dash-panel">
          <div class="panel-head">
            <span class="panel-head-title">Properties</span>
            <button class="btn btn-secondary btn-sm" onclick="Router.go('properties')">Manage</button>
          </div>
          ${props.map(p => {
            const tenant = Store.get(KEYS.tenants).find(t => t.propertyId === p.id && t.status === 'active')
            return `
              <div class="panel-row">
                <div>
                  <div class="panel-row-label">${esc(p.name)}</div>
                  <div class="panel-row-sub">${tenant ? tenant.firstName + ' ' + tenant.lastName : 'No tenant'}</div>
                </div>
                <div style="text-align:right">
                  ${badge(p.status)}
                  <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px">${fmt.currency(p.monthlyRent)}/mo</div>
                </div>
              </div>
            `
          }).join('')}
        </div>

        <div class="dash-panel">
          <div class="panel-head">
            <span class="panel-head-title">Active Repairs</span>
            <button class="btn btn-secondary btn-sm" onclick="Router.go('repairs')">View all</button>
          </div>
          ${repairs.filter(r => r.status !== 'completed').length
            ? repairs.filter(r => r.status !== 'completed').map(r => `
                <div class="panel-row">
                  <div>
                    <div class="panel-row-label">${esc(r.title)}</div>
                    <div class="panel-row-sub">${propName(r.propertyId)}</div>
                  </div>
                  ${badge(r.status)}
                </div>
              `).join('')
            : `<div class="panel-empty">No active repairs.</div>`}
        </div>

      </div>
    `
  }
}

// ── PROPERTIES ─────────────────────────────────────────────

Pages.properties = {
  render() {
    const props   = Store.get(KEYS.properties)
    const tenants = Store.get(KEYS.tenants)

    $('page-root').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">Properties</div>
          <div class="page-subtitle">${props.length} propert${props.length !== 1 ? 'ies' : 'y'} — add more anytime</div>
        </div>
        <button class="btn btn-primary" onclick="Pages.properties.add()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Property
        </button>
      </div>

      ${props.length === 0
        ? `<div class="no-data" style="background:var(--card);border-radius:var(--radius);border:1px solid var(--border)">
             <div style="font-size:32px;margin-bottom:12px;opacity:.35">🏠</div>
             <p>No properties yet. Add your first one to get started.</p>
           </div>`
        : `<div class="property-grid">
             ${props.map(p => {
               const tenant  = tenants.find(t => t.propertyId === p.id && t.status === 'active')
               const openRep = Store.where(KEYS.repairs,      'propertyId', p.id).filter(r => r.status !== 'completed').length
               const openItm = Store.where(KEYS.outstanding,  'propertyId', p.id).filter(o => o.status !== 'resolved').length
               return `
                 <div class="property-card">
                   <div class="property-card-top">
                     <div>
                       <div class="property-name">${esc(p.name)}</div>
                       <div class="property-address">${esc(p.address)}</div>
                     </div>
                     ${badge(p.status)}
                   </div>
                   <div class="property-tags">
                     <span class="badge badge-gray">${capitalize(p.type)}</span>
                     <span class="badge badge-gray">${p.bedrooms} bd · ${p.bathrooms} ba</span>
                   </div>
                   <div class="property-stats">
                     <div class="prop-stat">
                       <div class="prop-stat-label">Monthly Rent</div>
                       <div class="prop-stat-value">${fmt.currency(p.monthlyRent)}</div>
                     </div>
                     <div class="prop-stat">
                       <div class="prop-stat-label">Tenant</div>
                       <div class="prop-stat-value" style="font-size:12px">${tenant ? tenant.firstName + ' ' + tenant.lastName : '—'}</div>
                     </div>
                     <div class="prop-stat">
                       <div class="prop-stat-label">Open Items</div>
                       <div class="prop-stat-value">${openItm}</div>
                     </div>
                     <div class="prop-stat">
                       <div class="prop-stat-label">Active Repairs</div>
                       <div class="prop-stat-value">${openRep}</div>
                     </div>
                   </div>
                   <div class="property-card-footer">
                     <button class="btn btn-secondary btn-sm" onclick="Pages.properties.edit('${p.id}')">Edit</button>
                     <button class="btn btn-danger btn-sm"    onclick="Pages.properties.del('${p.id}')">Delete</button>
                   </div>
                 </div>
               `
             }).join('')}
           </div>`}
    `
  },

  _form(p = {}) {
    return `
      <form id="prop-form">
        <div class="form-row">
          <div class="form-group">
            <label>Property Name *</label>
            <input name="name" required value="${esc(p.name || '')}" placeholder="e.g. Oak Street House">
          </div>
          <div class="form-group">
            <label>Type</label>
            <select name="type">
              ${['house','condo','apartment','townhouse','duplex','other'].map(t =>
                `<option value="${t}"${(p.type||'house')===t?' selected':''}>${capitalize(t)}</option>`
              ).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Address *</label>
          <input name="address" required value="${esc(p.address || '')}" placeholder="123 Main St, City, State ZIP">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Bedrooms</label>
            <input name="bedrooms" type="number" min="0" value="${p.bedrooms ?? 2}">
          </div>
          <div class="form-group">
            <label>Bathrooms</label>
            <input name="bathrooms" type="number" min="0" step="0.5" value="${p.bathrooms ?? 1}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Monthly Rent ($)</label>
            <input name="monthlyRent" type="number" min="0" value="${p.monthlyRent ?? ''}">
          </div>
          <div class="form-group">
            <label>Status</label>
            <select name="status">
              <option value="vacant"  ${(p.status||'vacant')==='vacant'  ?' selected':''}>Vacant</option>
              <option value="occupied"${p.status==='occupied'?' selected':''}>Occupied</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea name="notes">${esc(p.notes || '')}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
          <button type="submit" class="btn btn-primary">${p.id ? 'Save Changes' : 'Add Property'}</button>
        </div>
      </form>
    `
  },

  add() {
    Modal.open('Add Property', this._form(), form => {
      const d = Object.fromEntries(new FormData(form))
      Store.add(KEYS.properties, { id: uuid(), ...d, bedrooms: +d.bedrooms, bathrooms: +d.bathrooms, monthlyRent: +d.monthlyRent, createdAt: today() })
      Modal.close(); Pages.properties.render()
    })
  },

  edit(id) {
    const p = Store.find(KEYS.properties, id)
    if (!p) return
    Modal.open('Edit Property', this._form(p), form => {
      const d = Object.fromEntries(new FormData(form))
      Store.update(KEYS.properties, id, { ...d, bedrooms: +d.bedrooms, bathrooms: +d.bathrooms, monthlyRent: +d.monthlyRent })
      Modal.close(); Pages.properties.render()
    })
  },

  del(id) {
    const p = Store.find(KEYS.properties, id)
    Modal.open('Delete Property', `
      <div class="confirm-body">
        <p>Delete <strong>${esc(p.name)}</strong>? Associated tenant, payment, and maintenance records will remain.</p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
        <button type="button" class="btn btn-danger" onclick="Pages.properties._del('${id}')">Delete Property</button>
      </div>
    `)
  },

  _del(id) { Store.remove(KEYS.properties, id); Modal.close(); Pages.properties.render() }
}

// ── TENANTS ────────────────────────────────────────────────

Pages.tenants = {
  propFilter: '',

  render() {
    const props   = Store.get(KEYS.properties)
    const tenants = this.propFilter ? Store.where(KEYS.tenants, 'propertyId', this.propFilter) : Store.get(KEYS.tenants)

    $('page-root').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">Tenants</div>
          <div class="page-subtitle">${tenants.length} tenant${tenants.length !== 1 ? 's' : ''}</div>
        </div>
        <button class="btn btn-primary" onclick="Pages.tenants.add()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Tenant
        </button>
      </div>

      <div class="filter-bar">
        <select onchange="Pages.tenants.propFilter=this.value;Pages.tenants.render()">
          <option value="">All Properties</option>
          ${props.map(p => `<option value="${p.id}"${this.propFilter===p.id?' selected':''}>${esc(p.name)}</option>`).join('')}
        </select>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Property</th><th>Contact</th><th>Lease Period</th><th>Rent</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${tenants.length ? tenants.map(t => `
              <tr>
                <td><strong>${esc(t.firstName)} ${esc(t.lastName)}</strong></td>
                <td style="font-size:12px">${propName(t.propertyId)}</td>
                <td>
                  <div>${esc(t.email)}</div>
                  <div style="font-size:11px;color:var(--text-muted)">${esc(t.phone)}</div>
                </td>
                <td style="font-size:12px">
                  ${fmt.date(t.leaseStart)}<br>
                  <span style="color:var(--text-muted)">to ${fmt.date(t.leaseEnd)}</span>
                </td>
                <td>${fmt.currency(t.rentAmount)}<span style="font-size:11px;color:var(--text-muted)">/mo</span></td>
                <td>${badge(t.status)}</td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-secondary btn-sm" onclick="Pages.tenants.edit('${t.id}')">Edit</button>
                    <button class="btn btn-danger btn-sm"    onclick="Pages.tenants.del('${t.id}')">Delete</button>
                  </div>
                </td>
              </tr>
            `).join('') : `<tr><td colspan="7" class="no-data">No tenants found.</td></tr>`}
          </tbody>
        </table>
      </div>
    `
  },

  _form(t = {}) {
    return `
      <form id="tenant-form">
        <div class="form-row">
          <div class="form-group">
            <label>First Name *</label>
            <input name="firstName" required value="${esc(t.firstName||'')}">
          </div>
          <div class="form-group">
            <label>Last Name *</label>
            <input name="lastName" required value="${esc(t.lastName||'')}">
          </div>
        </div>
        <div class="form-group">
          <label>Property *</label>
          <select name="propertyId" required>${propOptions(t.propertyId || this.propFilter)}</select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Email</label>
            <input name="email" type="email" value="${esc(t.email||'')}">
          </div>
          <div class="form-group">
            <label>Phone</label>
            <input name="phone" value="${esc(t.phone||'')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Lease Start</label>
            <input name="leaseStart" type="date" value="${t.leaseStart||''}">
          </div>
          <div class="form-group">
            <label>Lease End</label>
            <input name="leaseEnd" type="date" value="${t.leaseEnd||''}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Monthly Rent ($)</label>
            <input name="rentAmount" type="number" min="0" value="${t.rentAmount||''}">
          </div>
          <div class="form-group">
            <label>Security Deposit ($)</label>
            <input name="depositAmount" type="number" min="0" value="${t.depositAmount||''}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Deposit Paid</label>
            <select name="depositPaid">
              <option value="false"${!t.depositPaid?' selected':''}>No</option>
              <option value="true"${t.depositPaid?' selected':''}>Yes</option>
            </select>
          </div>
          <div class="form-group">
            <label>Status</label>
            <select name="status">
              <option value="active"${(t.status||'active')==='active'?' selected':''}>Active</option>
              <option value="former"${t.status==='former'?' selected':''}>Former</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea name="notes">${esc(t.notes||'')}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
          <button type="submit" class="btn btn-primary">${t.id ? 'Save Changes' : 'Add Tenant'}</button>
        </div>
      </form>
    `
  },

  add() {
    Modal.open('Add Tenant', this._form(), form => {
      const d = Object.fromEntries(new FormData(form))
      Store.add(KEYS.tenants, { id: uuid(), ...d, rentAmount: +d.rentAmount, depositAmount: +d.depositAmount, depositPaid: d.depositPaid === 'true', createdAt: today() })
      Modal.close(); Pages.tenants.render()
    })
  },

  edit(id) {
    const t = Store.find(KEYS.tenants, id)
    if (!t) return
    Modal.open('Edit Tenant', this._form(t), form => {
      const d = Object.fromEntries(new FormData(form))
      Store.update(KEYS.tenants, id, { ...d, rentAmount: +d.rentAmount, depositAmount: +d.depositAmount, depositPaid: d.depositPaid === 'true' })
      Modal.close(); Pages.tenants.render()
    })
  },

  del(id) {
    const t = Store.find(KEYS.tenants, id)
    Modal.open('Remove Tenant', `
      <div class="confirm-body">
        <p>Remove <strong>${esc(t.firstName)} ${esc(t.lastName)}</strong> from your records?</p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
        <button type="button" class="btn btn-danger" onclick="Pages.tenants._del('${id}')">Remove</button>
      </div>
    `)
  },

  _del(id) { Store.remove(KEYS.tenants, id); Modal.close(); Pages.tenants.render() }
}

// ── PAYMENTS ───────────────────────────────────────────────

Pages.payments = {
  propFilter:  '',
  monthFilter: '',

  render() {
    const props = Store.get(KEYS.properties)
    let pmts = Store.get(KEYS.payments)
    if (this.propFilter)  pmts = pmts.filter(p => p.propertyId === this.propFilter)
    if (this.monthFilter) pmts = pmts.filter(p => p.month === this.monthFilter)
    pmts = [...pmts].sort((a,b) => b.month.localeCompare(a.month) || b.createdAt.localeCompare(a.createdAt))

    const collected = pmts.filter(p => p.status === 'paid').reduce((s,p) => s + Number(p.amount), 0)

    $('page-root').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">Payments</div>
          <div class="page-subtitle">Track rent collection month by month</div>
        </div>
        <button class="btn btn-primary" onclick="Pages.payments.add()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Log Payment
        </button>
      </div>

      <div class="filter-bar">
        <select onchange="Pages.payments.propFilter=this.value;Pages.payments.render()">
          <option value="">All Properties</option>
          ${props.map(p => `<option value="${p.id}"${this.propFilter===p.id?' selected':''}>${esc(p.name)}</option>`).join('')}
        </select>
        <input type="month" value="${this.monthFilter}" onchange="Pages.payments.monthFilter=this.value;Pages.payments.render()" style="width:auto;min-width:150px">
        ${this.propFilter||this.monthFilter ? `<button class="btn btn-secondary btn-sm" onclick="Pages.payments.propFilter='';Pages.payments.monthFilter='';Pages.payments.render()">Clear filters</button>` : ''}
      </div>

      <div class="table-wrap">
        <div class="table-bar">
          <span class="table-bar-title">${pmts.length} record${pmts.length !== 1 ? 's' : ''}</span>
          <span style="font-size:13px;color:var(--text-muted)">Collected: <strong style="color:var(--text)">${fmt.currency(collected)}</strong></span>
        </div>
        <table>
          <thead>
            <tr><th>Tenant</th><th>Property</th><th>Month</th><th>Amount</th><th>Due</th><th>Paid</th><th>Method</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            ${pmts.length ? pmts.map(p => `
              <tr>
                <td>${tenantName(p.tenantId)}</td>
                <td style="font-size:12px">${propName(p.propertyId)}</td>
                <td style="white-space:nowrap">${fmt.monthLabel(p.month)}</td>
                <td><strong>${fmt.currency(p.amount)}</strong></td>
                <td style="font-size:12px">${fmt.date(p.dueDate)}</td>
                <td style="font-size:12px">${fmt.date(p.paidDate)}</td>
                <td style="font-size:12px">${p.method ? capitalize(p.method) : '—'}</td>
                <td>${badge(p.status)}</td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-secondary btn-sm" onclick="Pages.payments.edit('${p.id}')">Edit</button>
                    <button class="btn btn-danger btn-sm"    onclick="Pages.payments.del('${p.id}')">Delete</button>
                  </div>
                </td>
              </tr>
            `).join('') : `<tr><td colspan="9" class="no-data">No payments found.</td></tr>`}
          </tbody>
        </table>
      </div>
    `
  },

  _form(p = {}) {
    return `
      <form id="pmt-form">
        <div class="form-row">
          <div class="form-group">
            <label>Property *</label>
            <select name="propertyId" required onchange="Pages.payments._refreshTenants(this.value)">${propOptions(p.propertyId || this.propFilter)}</select>
          </div>
          <div class="form-group">
            <label>Tenant</label>
            <select name="tenantId" id="pmt-tenant-sel">${tenantOptions(p.propertyId || this.propFilter, p.tenantId)}</select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Month *</label>
            <input name="month" type="month" required value="${p.month || thisMonth()}">
          </div>
          <div class="form-group">
            <label>Amount ($) *</label>
            <input name="amount" type="number" min="0" required value="${p.amount||''}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Due Date</label>
            <input name="dueDate" type="date" value="${p.dueDate||''}">
          </div>
          <div class="form-group">
            <label>Date Paid</label>
            <input name="paidDate" type="date" value="${p.paidDate||''}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Status</label>
            <select name="status">
              <option value="pending"${(p.status||'pending')==='pending'?' selected':''}>Pending</option>
              <option value="paid"   ${p.status==='paid'   ?' selected':''}>Paid</option>
              <option value="late"   ${p.status==='late'   ?' selected':''}>Late</option>
            </select>
          </div>
          <div class="form-group">
            <label>Payment Method</label>
            <select name="method">
              <option value="">—</option>
              ${['bank transfer','zelle','venmo','check','cash','other'].map(m =>
                `<option value="${m}"${p.method===m?' selected':''}>${capitalize(m)}</option>`
              ).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea name="notes">${esc(p.notes||'')}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
          <button type="submit" class="btn btn-primary">${p.id ? 'Save Changes' : 'Log Payment'}</button>
        </div>
      </form>
    `
  },

  _refreshTenants(propId) {
    const sel = $('pmt-tenant-sel')
    if (sel) sel.innerHTML = tenantOptions(propId)
  },

  add() {
    Modal.open('Log Payment', this._form(), form => {
      const d = Object.fromEntries(new FormData(form))
      Store.add(KEYS.payments, { id: uuid(), ...d, amount: +d.amount, createdAt: today() })
      Modal.close(); Pages.payments.render()
    })
  },

  edit(id) {
    const p = Store.find(KEYS.payments, id)
    if (!p) return
    Modal.open('Edit Payment', this._form(p), form => {
      const d = Object.fromEntries(new FormData(form))
      Store.update(KEYS.payments, id, { ...d, amount: +d.amount })
      Modal.close(); Pages.payments.render()
    })
  },

  del(id) {
    Modal.open('Delete Payment', `
      <div class="confirm-body"><p>Delete this payment record?</p></div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
        <button type="button" class="btn btn-danger" onclick="Pages.payments._del('${id}')">Delete</button>
      </div>
    `)
  },

  _del(id) { Store.remove(KEYS.payments, id); Modal.close(); Pages.payments.render() }
}

// ── OUTSTANDING ITEMS ──────────────────────────────────────

Pages.outstanding = {
  propFilter: '',

  render() {
    const props = Store.get(KEYS.properties)
    const ORDER = { high: 0, medium: 1, low: 2 }
    let items = this.propFilter ? Store.where(KEYS.outstanding, 'propertyId', this.propFilter) : Store.get(KEYS.outstanding)
    items = [...items].sort((a,b) => (ORDER[a.priority] - ORDER[b.priority]) || a.createdAt.localeCompare(b.createdAt))
    const openCount = items.filter(i => i.status !== 'resolved').length

    $('page-root').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">Outstanding Items</div>
          <div class="page-subtitle">${openCount} open item${openCount !== 1 ? 's' : ''}</div>
        </div>
        <button class="btn btn-primary" onclick="Pages.outstanding.add()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Item
        </button>
      </div>

      <div class="filter-bar">
        <select onchange="Pages.outstanding.propFilter=this.value;Pages.outstanding.render()">
          <option value="">All Properties</option>
          ${props.map(p => `<option value="${p.id}"${this.propFilter===p.id?' selected':''}>${esc(p.name)}</option>`).join('')}
        </select>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Item</th><th>Property</th><th>Priority</th><th>Due</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            ${items.length ? items.map(item => `
              <tr>
                <td>
                  <strong>${esc(item.title)}</strong>
                  ${item.description ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(item.description)}</div>` : ''}
                </td>
                <td style="font-size:12px">${propName(item.propertyId)}</td>
                <td>${priorityBadge(item.priority)}</td>
                <td style="font-size:12px">${fmt.date(item.dueDate)}</td>
                <td>${badge(item.status)}</td>
                <td>
                  <div class="row-actions">
                    ${item.status !== 'resolved' ? `<button class="btn btn-secondary btn-sm" onclick="Pages.outstanding.resolve('${item.id}')">Resolve</button>` : ''}
                    <button class="btn btn-secondary btn-sm" onclick="Pages.outstanding.edit('${item.id}')">Edit</button>
                    <button class="btn btn-danger btn-sm"    onclick="Pages.outstanding.del('${item.id}')">Delete</button>
                  </div>
                </td>
              </tr>
            `).join('') : `<tr><td colspan="6" class="no-data">No items found.</td></tr>`}
          </tbody>
        </table>
      </div>
    `
  },

  _form(item = {}) {
    return `
      <form id="item-form">
        <div class="form-group">
          <label>Title *</label>
          <input name="title" required value="${esc(item.title||'')}" placeholder="Short description">
        </div>
        <div class="form-group">
          <label>Property</label>
          <select name="propertyId">${propOptions(item.propertyId || this.propFilter)}</select>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea name="description">${esc(item.description||'')}</textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Priority</label>
            <select name="priority">
              <option value="high"  ${(item.priority||'medium')==='high'  ?' selected':''}>High</option>
              <option value="medium"${(item.priority||'medium')==='medium'?' selected':''}>Medium</option>
              <option value="low"   ${item.priority==='low'               ?' selected':''}>Low</option>
            </select>
          </div>
          <div class="form-group">
            <label>Status</label>
            <select name="status">
              <option value="open"       ${(item.status||'open')==='open'       ?' selected':''}>Open</option>
              <option value="in-progress"${item.status==='in-progress'           ?' selected':''}>In Progress</option>
              <option value="resolved"   ${item.status==='resolved'              ?' selected':''}>Resolved</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Due Date</label>
          <input name="dueDate" type="date" value="${item.dueDate||''}">
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
          <button type="submit" class="btn btn-primary">${item.id ? 'Save Changes' : 'Add Item'}</button>
        </div>
      </form>
    `
  },

  add() {
    Modal.open('Add Outstanding Item', this._form(), form => {
      const d = Object.fromEntries(new FormData(form))
      Store.add(KEYS.outstanding, { id: uuid(), ...d, createdAt: today(), resolvedAt: '' })
      Modal.close(); Pages.outstanding.render()
    })
  },

  edit(id) {
    const item = Store.find(KEYS.outstanding, id)
    if (!item) return
    Modal.open('Edit Item', this._form(item), form => {
      const d = Object.fromEntries(new FormData(form))
      Store.update(KEYS.outstanding, id, d)
      Modal.close(); Pages.outstanding.render()
    })
  },

  resolve(id) {
    Store.update(KEYS.outstanding, id, { status: 'resolved', resolvedAt: today() })
    Pages.outstanding.render()
  },

  del(id) {
    Modal.open('Delete Item', `
      <div class="confirm-body"><p>Delete this outstanding item?</p></div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
        <button type="button" class="btn btn-danger" onclick="Pages.outstanding._del('${id}')">Delete</button>
      </div>
    `)
  },

  _del(id) { Store.remove(KEYS.outstanding, id); Modal.close(); Pages.outstanding.render() }
}

// ── REPAIRS ────────────────────────────────────────────────

Pages.repairs = {
  propFilter: '',

  render() {
    const props = Store.get(KEYS.properties)
    let repairs = this.propFilter ? Store.where(KEYS.repairs, 'propertyId', this.propFilter) : Store.get(KEYS.repairs)
    repairs = [...repairs].sort((a,b) => b.reportedDate.localeCompare(a.reportedDate))
    const activeCount = repairs.filter(r => r.status !== 'completed').length

    $('page-root').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">Repairs</div>
          <div class="page-subtitle">${activeCount} active repair${activeCount !== 1 ? 's' : ''}</div>
        </div>
        <button class="btn btn-primary" onclick="Pages.repairs.add()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Log Repair
        </button>
      </div>

      <div class="filter-bar">
        <select onchange="Pages.repairs.propFilter=this.value;Pages.repairs.render()">
          <option value="">All Properties</option>
          ${props.map(p => `<option value="${p.id}"${this.propFilter===p.id?' selected':''}>${esc(p.name)}</option>`).join('')}
        </select>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Repair</th><th>Property</th><th>Vendor</th><th>Est. Cost</th><th>Actual</th><th>Reported</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            ${repairs.length ? repairs.map(r => `
              <tr>
                <td>
                  <strong>${esc(r.title)}</strong>
                  ${r.description ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(r.description)}</div>` : ''}
                </td>
                <td style="font-size:12px">${propName(r.propertyId)}</td>
                <td style="font-size:12px">${r.vendor ? esc(r.vendor) : '—'}</td>
                <td>${r.estimatedCost ? fmt.currency(r.estimatedCost) : '—'}</td>
                <td>${r.actualCost    ? fmt.currency(r.actualCost)    : '—'}</td>
                <td style="font-size:12px">${fmt.date(r.reportedDate)}</td>
                <td>${badge(r.status)}</td>
                <td>
                  <div class="row-actions">
                    ${r.status !== 'completed' ? `<button class="btn btn-secondary btn-sm" onclick="Pages.repairs.complete('${r.id}')">Complete</button>` : ''}
                    <button class="btn btn-secondary btn-sm" onclick="Pages.repairs.edit('${r.id}')">Edit</button>
                    <button class="btn btn-danger btn-sm"    onclick="Pages.repairs.del('${r.id}')">Delete</button>
                  </div>
                </td>
              </tr>
            `).join('') : `<tr><td colspan="8" class="no-data">No repairs found.</td></tr>`}
          </tbody>
        </table>
      </div>
    `
  },

  _form(r = {}) {
    return `
      <form id="repair-form">
        <div class="form-group">
          <label>Title *</label>
          <input name="title" required value="${esc(r.title||'')}" placeholder="e.g. Fix leaking roof">
        </div>
        <div class="form-group">
          <label>Property</label>
          <select name="propertyId">${propOptions(r.propertyId || this.propFilter)}</select>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea name="description">${esc(r.description||'')}</textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Vendor / Contractor</label>
            <input name="vendor" value="${esc(r.vendor||'')}">
          </div>
          <div class="form-group">
            <label>Status</label>
            <select name="status">
              <option value="reported"   ${(r.status||'reported')==='reported'   ?' selected':''}>Reported</option>
              <option value="scheduled"  ${r.status==='scheduled'                 ?' selected':''}>Scheduled</option>
              <option value="in-progress"${r.status==='in-progress'               ?' selected':''}>In Progress</option>
              <option value="completed"  ${r.status==='completed'                 ?' selected':''}>Completed</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Estimated Cost ($)</label>
            <input name="estimatedCost" type="number" min="0" value="${r.estimatedCost||''}">
          </div>
          <div class="form-group">
            <label>Actual Cost ($)</label>
            <input name="actualCost" type="number" min="0" value="${r.actualCost||''}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Reported Date</label>
            <input name="reportedDate" type="date" value="${r.reportedDate || today()}">
          </div>
          <div class="form-group">
            <label>Completed Date</label>
            <input name="completedDate" type="date" value="${r.completedDate||''}">
          </div>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea name="notes">${esc(r.notes||'')}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
          <button type="submit" class="btn btn-primary">${r.id ? 'Save Changes' : 'Log Repair'}</button>
        </div>
      </form>
    `
  },

  add() {
    Modal.open('Log Repair', this._form(), form => {
      const d = Object.fromEntries(new FormData(form))
      Store.add(KEYS.repairs, { id: uuid(), ...d, estimatedCost: +d.estimatedCost||0, actualCost: +d.actualCost||0, createdAt: today() })
      Modal.close(); Pages.repairs.render()
    })
  },

  edit(id) {
    const r = Store.find(KEYS.repairs, id)
    if (!r) return
    Modal.open('Edit Repair', this._form(r), form => {
      const d = Object.fromEntries(new FormData(form))
      Store.update(KEYS.repairs, id, { ...d, estimatedCost: +d.estimatedCost||0, actualCost: +d.actualCost||0 })
      Modal.close(); Pages.repairs.render()
    })
  },

  complete(id) {
    Store.update(KEYS.repairs, id, { status: 'completed', completedDate: today() })
    Pages.repairs.render()
  },

  del(id) {
    Modal.open('Delete Repair', `
      <div class="confirm-body"><p>Delete this repair record?</p></div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
        <button type="button" class="btn btn-danger" onclick="Pages.repairs._del('${id}')">Delete</button>
      </div>
    `)
  },

  _del(id) { Store.remove(KEYS.repairs, id); Modal.close(); Pages.repairs.render() }
}

// ── EXPENSES ───────────────────────────────────────────────

const EXPENSE_CATS = ['mortgage','insurance','taxes','maintenance','utilities','repairs','management','other']

Pages.expenses = {
  propFilter: '',
  catFilter:  '',

  render() {
    const props = Store.get(KEYS.properties)
    let expenses = Store.get(KEYS.expenses)
    if (this.propFilter) expenses = expenses.filter(e => e.propertyId === this.propFilter)
    if (this.catFilter)  expenses = expenses.filter(e => e.category   === this.catFilter)
    expenses = [...expenses].sort((a,b) => b.date.localeCompare(a.date))
    const total = expenses.reduce((s,e) => s + Number(e.amount), 0)

    $('page-root').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">Expenses</div>
          <div class="page-subtitle">Track property costs and expenditures</div>
        </div>
        <button class="btn btn-primary" onclick="Pages.expenses.add()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Expense
        </button>
      </div>

      <div class="filter-bar">
        <select onchange="Pages.expenses.propFilter=this.value;Pages.expenses.render()">
          <option value="">All Properties</option>
          ${props.map(p => `<option value="${p.id}"${this.propFilter===p.id?' selected':''}>${esc(p.name)}</option>`).join('')}
        </select>
        <select onchange="Pages.expenses.catFilter=this.value;Pages.expenses.render()">
          <option value="">All Categories</option>
          ${EXPENSE_CATS.map(c => `<option value="${c}"${this.catFilter===c?' selected':''}>${capitalize(c)}</option>`).join('')}
        </select>
        ${this.propFilter||this.catFilter ? `<button class="btn btn-secondary btn-sm" onclick="Pages.expenses.propFilter='';Pages.expenses.catFilter='';Pages.expenses.render()">Clear filters</button>` : ''}
      </div>

      <div class="table-wrap">
        <div class="table-bar">
          <span class="table-bar-title">${expenses.length} expense${expenses.length !== 1 ? 's' : ''}</span>
          <span style="font-size:13px;color:var(--text-muted)">Total: <strong style="color:var(--text)">${fmt.currency(total)}</strong></span>
        </div>
        <table>
          <thead>
            <tr><th>Description</th><th>Property</th><th>Category</th><th>Amount</th><th>Date</th><th></th></tr>
          </thead>
          <tbody>
            ${expenses.length ? expenses.map(e => `
              <tr>
                <td>
                  <strong>${esc(e.description)}</strong>
                  ${e.notes ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(e.notes)}</div>` : ''}
                </td>
                <td style="font-size:12px">${propName(e.propertyId)}</td>
                <td><span class="badge badge-gray">${capitalize(e.category)}</span></td>
                <td><strong>${fmt.currency(e.amount)}</strong></td>
                <td style="font-size:12px">${fmt.date(e.date)}</td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-secondary btn-sm" onclick="Pages.expenses.edit('${e.id}')">Edit</button>
                    <button class="btn btn-danger btn-sm"    onclick="Pages.expenses.del('${e.id}')">Delete</button>
                  </div>
                </td>
              </tr>
            `).join('') : `<tr><td colspan="6" class="no-data">No expenses found.</td></tr>`}
          </tbody>
        </table>
      </div>
    `
  },

  _form(e = {}) {
    return `
      <form id="expense-form">
        <div class="form-group">
          <label>Description *</label>
          <input name="description" required value="${esc(e.description||'')}" placeholder="e.g. Annual insurance renewal">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Property</label>
            <select name="propertyId">${propOptions(e.propertyId || this.propFilter)}</select>
          </div>
          <div class="form-group">
            <label>Category</label>
            <select name="category">
              ${EXPENSE_CATS.map(c =>
                `<option value="${c}"${(e.category||'maintenance')===c?' selected':''}>${capitalize(c)}</option>`
              ).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Amount ($) *</label>
            <input name="amount" type="number" min="0" step="0.01" required value="${e.amount||''}">
          </div>
          <div class="form-group">
            <label>Date *</label>
            <input name="date" type="date" required value="${e.date || today()}">
          </div>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea name="notes">${esc(e.notes||'')}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
          <button type="submit" class="btn btn-primary">${e.id ? 'Save Changes' : 'Add Expense'}</button>
        </div>
      </form>
    `
  },

  add() {
    Modal.open('Add Expense', this._form(), form => {
      const d = Object.fromEntries(new FormData(form))
      Store.add(KEYS.expenses, { id: uuid(), ...d, amount: +d.amount, createdAt: today() })
      Modal.close(); Pages.expenses.render()
    })
  },

  edit(id) {
    const e = Store.find(KEYS.expenses, id)
    if (!e) return
    Modal.open('Edit Expense', this._form(e), form => {
      const d = Object.fromEntries(new FormData(form))
      Store.update(KEYS.expenses, id, { ...d, amount: +d.amount })
      Modal.close(); Pages.expenses.render()
    })
  },

  del(id) {
    Modal.open('Delete Expense', `
      <div class="confirm-body"><p>Delete this expense record?</p></div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
        <button type="button" class="btn btn-danger" onclick="Pages.expenses._del('${id}')">Delete</button>
      </div>
    `)
  },

  _del(id) { Store.remove(KEYS.expenses, id); Modal.close(); Pages.expenses.render() }
}

// ============================================================
//  Boot
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Wire desktop sidebar nav
  document.querySelectorAll('.nav-item[data-page]').forEach(el =>
    el.addEventListener('click', () => Router.go(el.dataset.page))
  )
  // Close modal on overlay click
  $('modal-overlay').addEventListener('click', e => {
    if (e.target === $('modal-overlay')) Modal.close()
  })
  // Seed + launch
  seed()
  Router.go('dashboard')
})
