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

// --- Supabase Config ---

const SUPABASE_URL = 'https://dypzppqiomaqigkbmzod.supabase.co'
const SUPABASE_KEY = 'sb_publishable_wlexg3cDJ2qOdVjQnCJsbQ_qy96oXfP'
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

// --- Storage (Supabase-backed with local cache) ---

// Table names in Supabase (also used as cache keys)
const TABLES = ['properties', 'tenants', 'payments', 'outstanding', 'repairs', 'expenses', 'events']

// Column name mapping: JS camelCase → Supabase snake_case
const COL_MAP = {
  propertyId:    'property_id',
  tenantId:      'tenant_id',
  monthlyRent:   'monthly_rent',
  firstName:     'first_name',
  lastName:      'last_name',
  leaseStart:    'lease_start',
  leaseEnd:      'lease_end',
  rentAmount:    'rent_amount',
  depositAmount: 'deposit_amount',
  depositPaid:   'deposit_paid',
  createdAt:     'created_at',
  dueDate:       'due_date',
  paidDate:      'paid_date',
  estimatedCost: 'estimated_cost',
  actualCost:    'actual_cost',
  reportedDate:  'reported_date',
  completedDate: 'completed_date',
  resolvedAt:    'resolved_at',
  recurringEnd:  'recurring_end',
}
const COL_MAP_REV = Object.fromEntries(Object.entries(COL_MAP).map(([k,v]) => [v, k]))

const DATE_COLS = new Set([
  'due_date','paid_date','lease_start','lease_end','reported_date',
  'completed_date','resolved_at','recurring_end','date','created_at'
])

function toSnake(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    const col = COL_MAP[k] || k
    // Convert empty strings to null for date/nullable columns
    out[col] = (v === '' || v === undefined) ? null : v
  }
  return out
}

function toCamel(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = COL_MAP_REV[k] || k
    // Convert null back to empty string for UI compatibility
    out[key] = v === null ? '' : v
  }
  return out
}

// In-memory cache — pages read from this synchronously
const _cache = {}
TABLES.forEach(t => {
  // Boot from localStorage for instant first paint
  _cache[t] = JSON.parse(localStorage.getItem('hs_' + t) || '[]')
})

function _saveCache(table) {
  localStorage.setItem('hs_' + table, JSON.stringify(_cache[table]))
}

// The Store object — same API as before, but writes go to Supabase too
const Store = {
  get(table) {
    return _cache[table] || []
  },

  set(table, arr) {
    _cache[table] = arr
    _saveCache(table)
  },

  find(table, id) {
    return (_cache[table] || []).find(x => x.id === id)
  },

  where(table, field, value) {
    return (_cache[table] || []).filter(x => x[field] === value)
  },

  // Add — write to cache immediately, then push to Supabase
  add(table, item) {
    _cache[table].push(item)
    _saveCache(table)
    // Async push to Supabase (fire-and-forget with error logging)
    const row = toSnake(item)
    sb.from(table).insert(row).then(({ error }) => {
      if (error) console.error(`Supabase insert ${table}:`, error.message)
    })
    return item
  },

  // Update — patch cache immediately, then push to Supabase
  update(table, id, patch) {
    _cache[table] = _cache[table].map(x => x.id === id ? { ...x, ...patch } : x)
    _saveCache(table)
    const row = toSnake(patch)
    sb.from(table).update(row).eq('id', id).then(({ error }) => {
      if (error) console.error(`Supabase update ${table}:`, error.message)
    })
  },

  // Remove — delete from cache immediately, then push to Supabase
  remove(table, id) {
    _cache[table] = _cache[table].filter(x => x.id !== id)
    _saveCache(table)
    sb.from(table).delete().eq('id', id).then(({ error }) => {
      if (error) console.error(`Supabase delete ${table}:`, error.message)
    })
  },
}

// --- Initial sync: pull all data from Supabase into cache ---

async function syncFromSupabase() {
  let changed = false
  for (const table of TABLES) {
    const { data, error } = await sb.from(table).select('*')
    if (error) {
      console.warn(`Sync ${table} failed:`, error.message)
      continue
    }
    if (data) {
      _cache[table] = data.map(toCamel)
      _saveCache(table)
      changed = true
    }
  }
  if (changed && typeof activePage !== 'undefined' && Pages[activePage]) {
    Pages[activePage].render()
  }
}

// --- Real-time subscriptions: listen for changes from other devices ---

function setupRealtime() {
  TABLES.forEach(table => {
    sb.channel(`rt-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload

        if (eventType === 'INSERT') {
          const item = toCamel(newRow)
          // Only add if not already in cache (avoid duplicating our own writes)
          if (!_cache[table].find(x => x.id === item.id)) {
            _cache[table].push(item)
            _saveCache(table)
          }
        } else if (eventType === 'UPDATE') {
          const item = toCamel(newRow)
          _cache[table] = _cache[table].map(x => x.id === item.id ? item : x)
          _saveCache(table)
        } else if (eventType === 'DELETE') {
          const id = oldRow.id
          _cache[table] = _cache[table].filter(x => x.id !== id)
          _saveCache(table)
        }

        // Re-render current page to reflect changes from other device
        if (Pages[activePage]) Pages[activePage].render()
      })
      .subscribe()
  })
}

// Legacy compat — old KEYS references
const KEYS = {}
TABLES.forEach(t => { KEYS[t] = t })

// --- Seed Data ---

async function seed() {
  // Check if Supabase already has data
  const { data } = await sb.from('properties').select('id').limit(1)
  if (data && data.length > 0) return // Already seeded
  if (localStorage.getItem('hs_seeded_sb')) return

  const p1 = { id: uuid(), name: 'Maple Avenue House',   address: '142 Maple Ave, Austin, TX 78701',        type: 'house',     bedrooms: 3, bathrooms: 2,   monthlyRent: 2400, status: 'occupied', notes: '', createdAt: '2024-01-15' }
  const p2 = { id: uuid(), name: 'Riverside Condo',      address: '88 Riverside Dr #4B, Austin, TX 78702',  type: 'condo',     bedrooms: 2, bathrooms: 1,   monthlyRent: 1800, status: 'occupied', notes: '', createdAt: '2024-03-01' }
  const p3 = { id: uuid(), name: 'Cedar Hill Duplex',    address: '310 Cedar Hill Rd, Austin, TX 78703',    type: 'house',     bedrooms: 4, bathrooms: 2.5, monthlyRent: 2900, status: 'vacant',   notes: 'Recently renovated kitchen', createdAt: '2024-06-10' }

  const t1 = { id: uuid(), propertyId: p1.id, firstName: 'Marcus',  lastName: 'Rivera', email: 'marcus.r@email.com',  phone: '(512) 555-0142', leaseStart: '2024-02-01', leaseEnd: '2025-01-31', rentAmount: 2400, depositAmount: 2400, depositPaid: true,  status: 'active', notes: '', createdAt: '2024-01-20' }
  const t2 = { id: uuid(), propertyId: p2.id, firstName: 'Priya',   lastName: 'Nair',   email: 'priya.nair@email.com', phone: '(512) 555-0198', leaseStart: '2024-03-15', leaseEnd: '2025-03-14', rentAmount: 1800, depositAmount: 1800, depositPaid: true,  status: 'active', notes: '', createdAt: '2024-03-10' }

  const pmts = []
  ;['2025-01','2025-02','2025-03'].forEach(m => {
    pmts.push({ id: uuid(), propertyId: p1.id, tenantId: t1.id, amount: 2400, month: m, dueDate: m+'-01', paidDate: m+'-02', status: 'paid',    method: 'bank transfer', notes: '', createdAt: m+'-01' })
    pmts.push({ id: uuid(), propertyId: p2.id, tenantId: t2.id, amount: 1800, month: m, dueDate: m+'-01', paidDate: m+'-04', status: 'paid',    method: 'zelle',         notes: '', createdAt: m+'-01' })
  })
  pmts.push({ id: uuid(), propertyId: p1.id, tenantId: t1.id, amount: 2400, month: '2025-04', dueDate: '2025-04-01', paidDate: null,         status: 'pending', method: '',              notes: '', createdAt: '2025-04-01' })
  pmts.push({ id: uuid(), propertyId: p2.id, tenantId: t2.id, amount: 1800, month: '2025-04', dueDate: '2025-04-01', paidDate: null,         status: 'late',    method: '',              notes: '', createdAt: '2025-04-01' })

  const outItems = [
    { id: uuid(), propertyId: p1.id, title: 'Replace kitchen faucet',        description: 'Tenant reported slow drip, needs new faucet.',    priority: 'medium', status: 'open',        dueDate: '2025-04-20', createdAt: '2025-04-02', resolvedAt: null },
    { id: uuid(), propertyId: p2.id, title: 'Annual HVAC inspection',        description: 'Schedule yearly service before summer heat.',      priority: 'low',    status: 'in-progress', dueDate: '2025-05-01', createdAt: '2025-03-15', resolvedAt: null },
    { id: uuid(), propertyId: p3.id, title: 'Deep clean before new tenant',  description: 'Full property clean and touch-up before listing.', priority: 'high',   status: 'open',        dueDate: '2025-04-15', createdAt: '2025-04-01', resolvedAt: null },
  ]

  const repairItems = [
    { id: uuid(), propertyId: p1.id, title: 'Broken back fence panel',        description: 'Storm damage to rear yard fence.',          vendor: 'Austin Fence Co.',  estimatedCost: 350, actualCost: 320, status: 'completed', reportedDate: '2025-02-10', completedDate: '2025-02-18', notes: '', createdAt: '2025-02-10' },
    { id: uuid(), propertyId: p2.id, title: 'Bathroom exhaust fan replacement', description: 'Fan stopped working, moisture buildup.',  vendor: '',                  estimatedCost: 150, actualCost: 0,   status: 'scheduled', reportedDate: '2025-03-28', completedDate: null,          notes: 'Appointment scheduled for Apr 12', createdAt: '2025-03-28' },
  ]

  const expenseItems = [
    { id: uuid(), propertyId: p1.id, category: 'insurance',    description: 'Annual homeowner insurance renewal',      amount: 1440, date: '2025-01-10', notes: '', createdAt: '2025-01-10' },
    { id: uuid(), propertyId: p2.id, category: 'maintenance',  description: 'Pest control — quarterly service',        amount:  120, date: '2025-02-05', notes: '', createdAt: '2025-02-05' },
    { id: uuid(), propertyId: p3.id, category: 'repairs',      description: 'Kitchen renovation — granite countertops', amount: 3200, date: '2025-03-20', notes: 'Part of pre-listing renovation', createdAt: '2025-03-20' },
    { id: uuid(), propertyId: p1.id, category: 'maintenance',  description: 'Lawn care — spring cleanup',              amount:   85, date: '2025-04-01', notes: '', createdAt: '2025-04-01' },
  ]

  // Push all seed data to Supabase
  const seedSets = [
    ['properties',  [p1, p2, p3]],
    ['tenants',     [t1, t2]],
    ['payments',    pmts],
    ['outstanding', outItems],
    ['repairs',     repairItems],
    ['expenses',    expenseItems],
  ]

  for (const [table, items] of seedSets) {
    const rows = items.map(toSnake)
    const { error } = await sb.from(table).insert(rows)
    if (error) console.error(`Seed ${table}:`, error.message)
    // Also put in local cache
    _cache[table] = items
    _saveCache(table)
  }

  localStorage.setItem('hs_seeded_sb', '1')
}

// --- About Overlay ---

const AboutOverlay = {
  open() {
    $('about-overlay').classList.remove('hidden')
    document.body.style.overflow = 'hidden'
  },
  close() {
    $('about-overlay').classList.add('hidden')
    document.body.style.overflow = ''
  }
}

// --- Panel (slide-in drawer — replaces Modal) ---

const Panel = {
  open(title, bodyHTML, onSubmit) {
    $('panel-title').textContent = title
    $('panel-body').innerHTML = bodyHTML
    $('panel-overlay').classList.remove('hidden')
    document.body.style.overflow = 'hidden'
    // Animate in
    requestAnimationFrame(() => {
      $('panel-drawer').classList.add('panel-drawer-visible')
    })
    if (onSubmit) {
      const form = $('panel-body').querySelector('form')
      if (form) form.addEventListener('submit', e => { e.preventDefault(); onSubmit(form) })
    }
  },
  close() {
    const drawer = $('panel-drawer')
    drawer.classList.remove('panel-drawer-visible')
    setTimeout(() => {
      $('panel-overlay').classList.add('hidden')
      $('panel-title').textContent = ''
      $('panel-body').innerHTML = ''
      document.body.style.overflow = ''
    }, 220)
  }
}

// Alias so existing code referencing Modal still works
const Modal = Panel

// --- Router ---

const PAGE_TITLES = {
  dashboard:   'Hearthstone',
  calendar:    'Calendar',
  properties:  'Properties',
  tenants:     'Tenants',
  payments:    'Payments',
  outstanding: 'Outstanding',
  repairs:     'Repairs',
  expenses:    'Expenses',
}

let activePage = 'dashboard'

const Router = {
  go(page) {
    activePage = page

    // Close any open panel
    if (!$('panel-overlay').classList.contains('hidden')) Panel.close()

    // Clear hub panel when leaving dashboard
    const hpr = $('hub-panel-root')
    if (hpr) hpr.innerHTML = ''

    // Update top bar
    const titleEl = $('top-bar-title')
    if (titleEl) titleEl.textContent = PAGE_TITLES[page] || page

    // Show/hide back button
    const backBtn = $('back-btn')
    if (backBtn) backBtn.classList.toggle('hidden', page === 'dashboard')

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
  _panel: null, // which panel is open

  _getPanel() { return $('hub-panel-root') ? $('hub-panel-root').querySelector('.hub-panel') : null },

  _open(key) {
    this._panel = key
    this._expanded = false
    this.render()
    requestAnimationFrame(() => {
      const p = this._getPanel()
      if (p) {
        p.classList.add('hub-panel-visible')
        this._initDrag(p)
      }
    })
  },

  _close() {
    const p = this._getPanel()
    if (p) {
      p.classList.remove('hub-panel-visible')
      p.classList.remove('hub-panel-expanded')
      setTimeout(() => { this._panel = null; this._expanded = false; this.render() }, 250)
    } else {
      this._panel = null; this._expanded = false; this.render()
    }
  },

  _expand() {
    const p = this._getPanel()
    if (p) {
      this._expanded = true
      p.classList.add('hub-panel-expanded')
    }
  },

  _collapse() {
    const p = this._getPanel()
    if (p) {
      this._expanded = false
      p.classList.remove('hub-panel-expanded')
    }
  },

  // Touch drag — expand / collapse / dismiss
  _initDrag(panel) {
    const self = this
    const headEl = panel.querySelector('.hub-panel-head')
    const bodyEl = panel.querySelector('.hub-panel-body')

    let startY = 0, lastY = 0, prevY = 0, velocity = 0
    let dragging = false
    let startTime = 0

    // Prevent page scroll/bounce while panel is open
    const backdrop = panel.previousElementSibling // .hub-panel-backdrop
    if (backdrop) {
      backdrop.addEventListener('touchmove', e => e.preventDefault(), { passive: false })
    }

    // Prevent body scroll while panel is visible
    panel.addEventListener('touchmove', function(e) {
      if (dragging) {
        e.preventDefault()
        return
      }
      // If body is scrolled to top and swiping down, start drag instead of scroll
      if (bodyEl && bodyEl.scrollTop <= 0) {
        const t = e.touches[0]
        if (t.clientY > startY + 5) {
          e.preventDefault()
        }
      }
    }, { passive: false })

    function startDrag(e) {
      const t = e.touches[0]
      startY = t.clientY
      lastY = startY
      prevY = startY
      velocity = 0
      startTime = Date.now()
      dragging = true
      panel.style.transition = 'none'
    }

    function moveDrag(e) {
      if (!dragging) return
      e.preventDefault()
      const t = e.touches[0]
      prevY = lastY
      lastY = t.clientY
      const dy = lastY - startY

      // Track velocity (px per ms)
      const now = Date.now()
      const dt = now - startTime
      if (dt > 0) velocity = (lastY - prevY) / Math.max(dt / 60, 1)

      if (self._expanded) {
        // Expanded: only allow pulling down, with rubber-band resistance for up
        if (dy > 0) {
          panel.style.transform = `translateY(${dy}px)`
        } else {
          // Rubber band upward
          panel.style.transform = `translateY(${dy * 0.15}px)`
        }
      } else {
        // Peek: allow up (expand) and down (dismiss)
        if (dy < 0) {
          // Pulling up — rubber band after a point
          const maxUp = window.innerHeight * 0.25
          const clamped = Math.max(dy, -maxUp)
          const rubber = clamped < -50 ? -50 + (clamped + 50) * 0.3 : clamped
          panel.style.transform = `translateY(${rubber}px)`
        } else {
          panel.style.transform = `translateY(${dy}px)`
        }
      }
    }

    function endDrag() {
      if (!dragging) return
      dragging = false
      const dy = lastY - startY
      const fast = Math.abs(velocity) > 2 // fast flick threshold

      // Smooth snap-back transition
      panel.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)'
      panel.style.transform = ''

      // Clear inline transition after animation
      setTimeout(() => {
        if (panel) {
          panel.style.transition = ''
          panel.style.transform = ''
        }
      }, 320)

      if (self._expanded) {
        // From expanded
        if ((dy > 80 && velocity > 0) || (fast && velocity > 0 && dy > 30)) {
          if (dy > 200 || (fast && velocity > 4)) {
            self._close()
          } else {
            self._collapse()
          }
        }
      } else {
        // From peek
        if ((dy < -40 && velocity <= 0) || (fast && velocity < 0)) {
          self._expand()
        } else if ((dy > 50 && velocity >= 0) || (fast && velocity > 0 && dy > 20)) {
          self._close()
        }
      }
    }

    // Header area — always draggable
    if (headEl) {
      headEl.style.touchAction = 'none' // disable browser gestures on header
      headEl.addEventListener('touchstart', startDrag, { passive: true })
      headEl.addEventListener('touchmove', moveDrag, { passive: false })
      headEl.addEventListener('touchend', endDrag, { passive: true })
    }

    // Body — start drag only when scrolled to top and pulling down
    if (bodyEl) {
      bodyEl.addEventListener('touchstart', function(e) {
        const t = e.touches[0]
        startY = t.clientY
        lastY = startY
        prevY = startY
        startTime = Date.now()
      }, { passive: true })

      bodyEl.addEventListener('touchmove', function(e) {
        if (dragging) {
          moveDrag(e)
          return
        }
        const t = e.touches[0]
        const dy = t.clientY - startY
        // If at top of scroll and pulling down → hijack into drag
        if (bodyEl.scrollTop <= 0 && dy > 8) {
          dragging = true
          panel.style.transition = 'none'
          moveDrag(e)
        }
      }, { passive: false })

      bodyEl.addEventListener('touchend', function() {
        if (dragging) endDrag()
      }, { passive: true })
    }
  },

  render() {
    const props    = Store.get(KEYS.properties)
    const allTenants = Store.get(KEYS.tenants)
    const tenants  = allTenants.filter(t => t.status === 'active')
    const payments = Store.get(KEYS.payments)
    const open     = Store.get(KEYS.outstanding).filter(o => o.status !== 'resolved')
    const repairs  = Store.get(KEYS.repairs)
    const activeRep = repairs.filter(r => r.status !== 'completed')

    const mon       = thisMonth()
    const monPmts   = payments.filter(p => p.month === mon)
    const collected = monPmts.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0)
    const expected  = tenants.reduce((s, t) => s + Number(t.rentAmount), 0)
    const vacant    = props.filter(p => p.status === 'vacant').length

    const recentPmts = [...payments].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)

    // SVG icons — large (80px)
    const ic = (d) => `<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
    const svgProp   = ic(`<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/>`)
    const svgTenant = ic(`<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`)
    const svgMoney  = ic(`<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>`)
    const svgRepair = ic(`<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>`)
    const svgItems  = ic(`<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="2"/><path d="m9 12 2 2 4-4"/>`)
    const svgCal    = ic(`<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`)

    // Calendar upcoming events (next 7 days)
    const todayStr = today()
    const next7 = new Date(); next7.setDate(next7.getDate() + 7)
    const next7Str = next7.toISOString().split('T')[0]
    const curMonthEvents = Pages.calendar._gatherEvents(new Date().getFullYear(), new Date().getMonth())
    const nextMo = new Date().getMonth() + 1
    const nextMoYear = nextMo > 11 ? new Date().getFullYear() + 1 : new Date().getFullYear()
    const nextMonthEvents = Pages.calendar._gatherEvents(nextMoYear, nextMo % 12)
    const combinedEvents = { ...curMonthEvents }
    for (const [k, v] of Object.entries(nextMonthEvents)) {
      if (!combinedEvents[k]) combinedEvents[k] = []
      combinedEvents[k].push(...v)
    }
    const upcomingDates = Object.keys(combinedEvents).filter(d => d >= todayStr && d <= next7Str).sort()
    let upcomingCount = 0
    upcomingDates.forEach(d => { upcomingCount += combinedEvents[d].length })

    // Action row helper — swipeable row with edit/delete
    const actRow = (content, editFn, delFn) => `
      <div class="panel-row panel-row-actions">
        <div class="panel-row-content">${content}</div>
        <div class="panel-row-btns">
          <button class="panel-act-btn panel-act-edit" onclick="event.stopPropagation();${editFn}">Edit</button>
          <button class="panel-act-btn panel-act-del" onclick="event.stopPropagation();${delFn}">Delete</button>
        </div>
      </div>`

    // Detail content builders — with inline actions
    const calDetail = upcomingDates.length ? upcomingDates.map(dateStr => {
      const dayLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      return combinedEvents[dateStr].map(e => `<div class="panel-row"><div><div class="panel-row-label">${e.label}</div><div class="panel-row-sub">${dayLabel} · ${e.sub}</div></div><span class="cal-dot ${e.color}" style="width:10px;height:10px"></span></div>`).join('')
    }).join('') : `<div class="panel-empty">No events in the next 7 days.</div>`

    const propDetail = props.length ? props.map(p => {
      const tenant = allTenants.find(t => t.propertyId === p.id && t.status === 'active')
      const content = `<div><div class="panel-row-label">${esc(p.name)}</div><div class="panel-row-sub">${tenant ? tenant.firstName + ' ' + tenant.lastName : 'No tenant'}</div></div><div style="text-align:right">${badge(p.status)}<div style="font-size:11.5px;color:var(--text-muted);margin-top:3px">${fmt.currency(p.monthlyRent)}/mo</div></div>`
      return actRow(content, `Pages.dashboard._close();Pages.properties.edit('${p.id}')`, `Pages.dashboard._close();Pages.properties.del('${p.id}')`)
    }).join('') : `<div class="panel-empty">No properties yet.</div>`

    const tenantDetail = tenants.length ? tenants.map(t => {
      const content = `<div><div class="panel-row-label">${esc(t.firstName)} ${esc(t.lastName)}</div><div class="panel-row-sub">${propName(t.propertyId)} · ${esc(t.email)}</div></div><div style="text-align:right">${badge(t.status)}<div style="font-size:11.5px;color:var(--text-muted);margin-top:3px">${fmt.currency(t.rentAmount)}/mo</div></div>`
      return actRow(content, `Pages.dashboard._close();Pages.tenants.edit('${t.id}')`, `Pages.dashboard._close();Pages.tenants.del('${t.id}')`)
    }).join('') : `<div class="panel-empty">No active tenants.</div>`

    const payDetail = recentPmts.length ? recentPmts.map(p => {
      const content = `<div><div class="panel-row-label">${tenantName(p.tenantId)}</div><div class="panel-row-sub">${propName(p.propertyId)} · ${fmt.monthLabel(p.month)}</div></div><div style="text-align:right"><div style="font-weight:600;font-size:13px">${fmt.currency(p.amount)}</div><div style="margin-top:3px">${badge(p.status)}</div></div>`
      return actRow(content, `Pages.dashboard._close();Pages.payments.edit('${p.id}')`, `Pages.dashboard._close();Pages.payments.del('${p.id}')`)
    }).join('') : `<div class="panel-empty">No payments recorded.</div>`

    const repairDetail = activeRep.length ? activeRep.map(r => {
      const content = `<div><div class="panel-row-label">${esc(r.title)}</div><div class="panel-row-sub">${propName(r.propertyId)}</div></div>${badge(r.status)}`
      return actRow(content, `Pages.dashboard._close();Pages.repairs.edit('${r.id}')`, `Pages.dashboard._close();Pages.repairs.del('${r.id}')`)
    }).join('') : `<div class="panel-empty">No active repairs.</div>`

    const itemDetail = open.length ? open.slice(0, 6).map(o => {
      const content = `<div><div class="panel-row-label">${esc(o.title)}</div><div class="panel-row-sub">${propName(o.propertyId)}</div></div><div style="text-align:right">${priorityBadge(o.priority)}<div style="margin-top:3px">${badge(o.status)}</div></div>`
      return actRow(content, `Pages.dashboard._close();Pages.outstanding.edit('${o.id}')`, `Pages.dashboard._close();Pages.outstanding.del('${o.id}')`)
    }).join('') : `<div class="panel-empty">No open items — great work!</div>`

    // Tile config
    const tiles = [
      { key: 'properties', svg: svgProp,   label: 'Properties', count: props.length,           meta: `${vacant} vacant`,                                             color: 'accent',  detail: propDetail },
      { key: 'tenants',    svg: svgTenant, label: 'Tenants',    count: tenants.length,          meta: `across ${props.length} propert${props.length!==1?'ies':'y'}`,   color: 'blue',    detail: tenantDetail },
      { key: 'money',      svg: svgMoney,  label: 'Payments',   count: fmt.currency(collected), meta: `of ${fmt.currency(expected)} expected`,                         color: 'green',   detail: payDetail },
      { key: 'repairs',    svg: svgRepair, label: 'Repairs',    count: activeRep.length,        meta: `${repairs.length} total`,                                       color: 'orange',  detail: repairDetail },
      { key: 'items',      svg: svgItems,  label: 'Open Items', count: open.length,             meta: `${open.filter(o=>o.priority==='high').length} high priority`,   color: 'amber',   detail: itemDetail },
      { key: 'cal',        svg: svgCal,    label: 'Calendar',   count: upcomingCount,           meta: `upcoming in 7 days`,                                            color: 'purple',  detail: calDetail },
    ]

    const pageMap = { money: 'payments', items: 'outstanding', cal: 'calendar' }
    const panel = this._panel
    const activeTile = panel ? tiles.find(t => t.key === panel) : null

    const tilesHTML = tiles.map(t => `
      <button class="hub-tile${panel === t.key ? ' hub-tile-active' : ''}" onclick="Pages.dashboard._open('${t.key}')">
        <div class="hub-tile-icon" style="color:var(--${t.color})">${t.svg}</div>
        <div class="hub-tile-info">
          <div class="hub-tile-count">${t.count}</div>
          <div class="hub-tile-label">${t.label}</div>
          <div class="hub-tile-meta">${t.meta}</div>
        </div>
      </button>
    `).join('')

    // Add button config per tile
    const addMap = {
      properties: `Pages.dashboard._close();Pages.properties.add()`,
      tenants:    `Pages.dashboard._close();Pages.tenants.add()`,
      money:      `Pages.dashboard._close();Pages.payments.add()`,
      repairs:    `Pages.dashboard._close();Pages.repairs.add()`,
      items:      `Pages.dashboard._close();Pages.outstanding.add()`,
      cal:        `Pages.dashboard._close();Pages.calendar.addEvent()`,
    }

    const panelHTML = panel && activeTile ? `
      <div class="hub-panel-backdrop" onclick="Pages.dashboard._close()"></div>
      <div class="hub-panel">
        <div class="hub-panel-head">
          <div>
            <div class="hub-panel-title">${activeTile.label}</div>
            <div class="hub-panel-subtitle">${activeTile.count} · ${activeTile.meta}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();${addMap[panel]}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add
            </button>
            <button class="hub-panel-close" onclick="Pages.dashboard._close()">&#x2715;</button>
          </div>
        </div>
        <div class="hub-panel-body">
          ${activeTile.detail}
        </div>
        <div class="hub-panel-footer">
          <button class="btn btn-secondary btn-sm" onclick="Router.go('${pageMap[panel] || panel}')" style="width:100%">
            View all ${activeTile.label.toLowerCase()}
          </button>
        </div>
      </div>
    ` : ''

    $('page-root').innerHTML = `
      <div class="hub-layout">
        <div class="hub-list">
          ${tilesHTML}
        </div>
      </div>
    `
    // Render panel outside scroll container so position:fixed works on mobile Safari
    $('hub-panel-root').innerHTML = panelHTML
  }
}

// ── CALENDAR ───────────────────────────────────────────────

Pages.calendar = {
  // State
  viewYear:  new Date().getFullYear(),
  viewMonth: new Date().getMonth(), // 0-indexed
  selectedDate: null,

  // Gather every event for a given month into a { 'YYYY-MM-DD': [...] } map
  _gatherEvents(year, month) {
    const events = {}
    const push = (dateStr, evt) => {
      if (!dateStr) return
      // Only include if it falls in the viewed month
      const [y, m] = dateStr.split('-').map(Number)
      if (y === year && m - 1 === month) {
        if (!events[dateStr]) events[dateStr] = []
        events[dateStr].push(evt)
      }
    }

    // Payments — use paidDate for paid, dueDate for pending/late
    Store.get(KEYS.payments).forEach(p => {
      if (p.status === 'paid') {
        push(p.paidDate, { type: 'payment-paid', color: 'cal-green', icon: '💰', label: `Rent collected — ${tenantName(p.tenantId)}`, sub: `${propName(p.propertyId)} · ${fmt.currency(p.amount)}`, page: 'payments' })
      } else if (p.status === 'late') {
        push(p.dueDate, { type: 'payment-late', color: 'cal-red', icon: '⚠', label: `Late payment — ${tenantName(p.tenantId)}`, sub: `${propName(p.propertyId)} · ${fmt.currency(p.amount)} due`, page: 'payments' })
      } else {
        push(p.dueDate, { type: 'payment-pending', color: 'cal-amber', icon: '⏳', label: `Rent due — ${tenantName(p.tenantId)}`, sub: `${propName(p.propertyId)} · ${fmt.currency(p.amount)}`, page: 'payments' })
      }
    })

    // Repairs — reportedDate for open, completedDate for completed
    Store.get(KEYS.repairs).forEach(r => {
      if (r.status === 'completed') {
        push(r.completedDate, { type: 'repair-done', color: 'cal-green-outline', icon: '✓', label: `Repair completed — ${esc(r.title)}`, sub: `${propName(r.propertyId)}${r.actualCost ? ' · ' + fmt.currency(r.actualCost) : ''}`, page: 'repairs' })
      }
      push(r.reportedDate, { type: 'repair', color: 'cal-orange', icon: '🔧', label: `${capitalize(r.status)} — ${esc(r.title)}`, sub: propName(r.propertyId), page: 'repairs' })
    })

    // Outstanding items — createdAt for open, resolvedAt for resolved
    Store.get(KEYS.outstanding).forEach(o => {
      if (o.status === 'resolved' && o.resolvedAt) {
        push(o.resolvedAt, { type: 'item-done', color: 'cal-green-outline', icon: '✓', label: `Resolved — ${esc(o.title)}`, sub: propName(o.propertyId), page: 'outstanding' })
      }
      push(o.dueDate || o.createdAt, { type: 'item', color: 'cal-amber', icon: '📋', label: `${capitalize(o.status)} — ${esc(o.title)}`, sub: `${propName(o.propertyId)} · ${capitalize(o.priority)} priority`, page: 'outstanding' })
    })

    // Expenses — date
    Store.get(KEYS.expenses).forEach(e => {
      push(e.date, { type: 'expense', color: 'cal-blue', icon: '🧾', label: `${esc(e.description)}`, sub: `${propName(e.propertyId)} · ${capitalize(e.category)} · ${fmt.currency(e.amount)}`, page: 'expenses' })
    })

    // Custom calendar events (including recurring instances)
    const monthStart = `${year}-${String(month+1).padStart(2,'0')}-01`
    const monthEnd   = `${year}-${String(month+1).padStart(2,'0')}-${String(new Date(year,month+1,0).getDate()).padStart(2,'0')}`

    Store.get(KEYS.events).forEach(ev => {
      const colorMap = { green: 'cal-green', red: 'cal-red', orange: 'cal-orange', amber: 'cal-amber', blue: 'cal-blue', purple: 'cal-purple' }
      const evColor = colorMap[ev.color] || 'cal-blue'
      const iconMap = { green: '📅', red: '🔴', orange: '🟠', amber: '🟡', blue: '🔵', purple: '🟣' }
      const evIcon = iconMap[ev.color] || '📅'

      if (ev.recurring && ev.recurring !== 'none') {
        // Generate recurring instances for this month
        const instances = Pages.calendar._recurringDates(ev, year, month)
        instances.forEach(dateStr => {
          push(dateStr, { type: 'custom-event', color: evColor, icon: evIcon, label: esc(ev.title), sub: ev.notes ? esc(ev.notes) : (ev.recurring === 'weekly' ? 'Weekly' : ev.recurring === 'monthly' ? 'Monthly' : 'Yearly'), page: 'calendar', eventId: ev.id })
        })
      } else {
        push(ev.date, { type: 'custom-event', color: evColor, icon: evIcon, label: esc(ev.title), sub: ev.notes ? esc(ev.notes) : 'Custom event', page: 'calendar', eventId: ev.id })
      }
    })

    return events
  },

  _monthLabel() {
    return new Date(this.viewYear, this.viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  },

  _prev() { this.viewMonth--; if (this.viewMonth < 0) { this.viewMonth = 11; this.viewYear-- } this.selectedDate = null; this.render() },
  _next() { this.viewMonth++; if (this.viewMonth > 11) { this.viewMonth = 0; this.viewYear++ } this.selectedDate = null; this.render() },
  _today() { this.viewYear = new Date().getFullYear(); this.viewMonth = new Date().getMonth(); this.selectedDate = today(); this.render() },

  // Generate all dates a recurring event falls on within a given month
  _recurringDates(ev, year, month) {
    const dates = []
    const startDate = new Date(ev.date + 'T00:00:00')
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const endStr = ev.recurringEnd || ''

    for (let d = 1; d <= daysInMonth; d++) {
      const candidate = new Date(year, month, d)
      const candStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`

      // Must be on or after the start date
      if (candidate < startDate) continue
      // Must be on or before end date if set
      if (endStr && candStr > endStr) continue

      if (ev.recurring === 'daily') {
        dates.push(candStr)
      } else if (ev.recurring === 'weekly') {
        if (candidate.getDay() === startDate.getDay()) dates.push(candStr)
      } else if (ev.recurring === 'biweekly') {
        if (candidate.getDay() === startDate.getDay()) {
          const diffWeeks = Math.round((candidate - startDate) / (7 * 86400000))
          if (diffWeeks % 2 === 0) dates.push(candStr)
        }
      } else if (ev.recurring === 'monthly') {
        if (candidate.getDate() === startDate.getDate()) dates.push(candStr)
      } else if (ev.recurring === 'yearly') {
        if (candidate.getDate() === startDate.getDate() && candidate.getMonth() === startDate.getMonth()) dates.push(candStr)
      }
    }
    return dates
  },

  // Event form
  _eventForm(ev = {}) {
    return `
      <form id="event-form">
        <div class="form-group">
          <label>Event Title *</label>
          <input name="title" required value="${esc(ev.title || '')}" placeholder="e.g. Lease renewal, Inspection">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Date *</label>
            <input name="date" type="date" required value="${ev.date || this.selectedDate || today()}">
          </div>
          <div class="form-group">
            <label>Color</label>
            <select name="color">
              ${['green','blue','orange','amber','red','purple'].map(c =>
                `<option value="${c}"${(ev.color||'blue')===c?' selected':''}>${capitalize(c)}</option>`
              ).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Recurring</label>
            <select name="recurring">
              <option value="none"${(ev.recurring||'none')==='none'?' selected':''}>None (one-time)</option>
              <option value="daily"${ev.recurring==='daily'?' selected':''}>Daily</option>
              <option value="weekly"${ev.recurring==='weekly'?' selected':''}>Weekly</option>
              <option value="biweekly"${ev.recurring==='biweekly'?' selected':''}>Every 2 weeks</option>
              <option value="monthly"${ev.recurring==='monthly'?' selected':''}>Monthly</option>
              <option value="yearly"${ev.recurring==='yearly'?' selected':''}>Yearly</option>
            </select>
          </div>
          <div class="form-group">
            <label>Recurring Until</label>
            <input name="recurringEnd" type="date" value="${ev.recurringEnd || ''}">
          </div>
        </div>
        <div class="form-group">
          <label>Property (optional)</label>
          <select name="propertyId">${propOptions(ev.propertyId || '', true)}</select>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea name="notes">${esc(ev.notes || '')}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
          <button type="submit" class="btn btn-primary">${ev.id ? 'Save Changes' : 'Add Event'}</button>
        </div>
      </form>
    `
  },

  addEvent() {
    Modal.open('Add Calendar Event', this._eventForm(), form => {
      const d = Object.fromEntries(new FormData(form))
      Store.add(KEYS.events, { id: uuid(), ...d, createdAt: today() })
      Modal.close(); this.render()
    })
  },

  editEvent(id) {
    const ev = Store.find(KEYS.events, id)
    if (!ev) return
    Modal.open('Edit Event', this._eventForm(ev), form => {
      const d = Object.fromEntries(new FormData(form))
      Store.update(KEYS.events, id, d)
      Modal.close(); this.render()
    })
  },

  delEvent(id) {
    const ev = Store.find(KEYS.events, id)
    Modal.open('Delete Event', `
      <div class="confirm-body"><p>Delete <strong>${esc(ev.title)}</strong>${ev.recurring && ev.recurring !== 'none' ? ' and all recurring instances' : ''}?</p></div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
        <button type="button" class="btn btn-danger" onclick="Store.remove(KEYS.events,'${id}');Modal.close();Pages.calendar.render()">Delete</button>
      </div>
    `)
  },

  render() {
    const year = this.viewYear
    const month = this.viewMonth
    const events = this._gatherEvents(year, month)

    const firstDay = new Date(year, month, 1).getDay() // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const todayStr = today()

    // Build grid cells
    let cells = ''

    // Empty leading cells
    for (let i = 0; i < firstDay; i++) {
      cells += `<div class="cal-cell cal-empty"></div>`
    }

    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const dayEvents = events[dateStr] || []
      const isToday = dateStr === todayStr
      const isSelected = dateStr === this.selectedDate
      const hasEvents = dayEvents.length > 0

      // Collect unique dot colors (max 5 shown)
      const dotColors = [...new Set(dayEvents.map(e => e.color))].slice(0, 5)

      cells += `
        <div class="cal-cell${isToday ? ' cal-today' : ''}${isSelected ? ' cal-selected' : ''}${hasEvents ? ' cal-has-events' : ''}"
             onclick="Pages.calendar.selectedDate='${dateStr}';Pages.calendar.render()">
          <span class="cal-day-num">${d}</span>
          ${dotColors.length ? `<div class="cal-dots">${dotColors.map(c => `<span class="cal-dot ${c}"></span>`).join('')}</div>` : ''}
        </div>
      `
    }

    // Detail panel for selected date
    let detailHTML = ''
    if (this.selectedDate && events[this.selectedDate]) {
      const sel = events[this.selectedDate]
      const selDate = new Date(this.selectedDate + 'T00:00:00')
      const dateLabel = selDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

      detailHTML = `
        <div class="cal-detail">
          <div class="cal-detail-head">
            <span class="cal-detail-date">${dateLabel}</span>
            <span class="cal-detail-count">${sel.length} event${sel.length !== 1 ? 's' : ''}</span>
          </div>
          ${sel.map(e => `
            <div class="cal-detail-row"${e.type !== 'custom-event' ? ` onclick="Router.go('${e.page}')"` : ''}>
              <span class="cal-detail-icon ${e.color}">${e.icon}</span>
              <div class="cal-detail-text">
                <div class="cal-detail-label">${e.label}</div>
                <div class="cal-detail-sub">${e.sub}</div>
              </div>
              ${e.type === 'custom-event' && e.eventId ? `
                <div class="row-actions" onclick="event.stopPropagation()">
                  <button class="btn btn-secondary btn-sm" onclick="Pages.calendar.editEvent('${e.eventId}')">Edit</button>
                  <button class="btn btn-danger btn-sm" onclick="Pages.calendar.delEvent('${e.eventId}')">Delete</button>
                </div>
              ` : `
                <svg class="cal-detail-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              `}
            </div>
          `).join('')}
        </div>
      `
    } else if (this.selectedDate) {
      const selDate = new Date(this.selectedDate + 'T00:00:00')
      const dateLabel = selDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      detailHTML = `
        <div class="cal-detail">
          <div class="cal-detail-head">
            <span class="cal-detail-date">${dateLabel}</span>
          </div>
          <div class="cal-detail-empty">No events on this day.</div>
        </div>
      `
    }

    // Legend
    const legend = `
      <div class="cal-legend">
        <span class="cal-legend-item"><span class="cal-dot cal-green"></span> Rent collected</span>
        <span class="cal-legend-item"><span class="cal-dot cal-red"></span> Late / overdue</span>
        <span class="cal-legend-item"><span class="cal-dot cal-orange"></span> Repairs</span>
        <span class="cal-legend-item"><span class="cal-dot cal-amber"></span> Outstanding / due</span>
        <span class="cal-legend-item"><span class="cal-dot cal-blue"></span> Expenses / events</span>
        <span class="cal-legend-item"><span class="cal-dot cal-purple"></span> Custom events</span>
        <span class="cal-legend-item"><span class="cal-dot cal-green-outline"></span> Completed</span>
      </div>
    `

    // Count total events this month
    const totalEvents = Object.values(events).reduce((s, arr) => s + arr.length, 0)

    $('page-root').innerHTML = `
      <div class="page-header">
        <div>
          <div class="page-title">Calendar</div>
          <div class="page-subtitle">${totalEvents} event${totalEvents !== 1 ? 's' : ''} in ${this._monthLabel()}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary" onclick="Pages.calendar._today()">Today</button>
          <button class="btn btn-primary" onclick="Pages.calendar.addEvent()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Event
          </button>
        </div>
      </div>

      <div class="cal-wrap">
        <div class="cal-nav">
          <button class="btn btn-secondary btn-sm" onclick="Pages.calendar._prev()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="cal-month-label">${this._monthLabel()}</span>
          <button class="btn btn-secondary btn-sm" onclick="Pages.calendar._next()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>

        <div class="cal-grid">
          <div class="cal-head">Sun</div><div class="cal-head">Mon</div><div class="cal-head">Tue</div>
          <div class="cal-head">Wed</div><div class="cal-head">Thu</div><div class="cal-head">Fri</div><div class="cal-head">Sat</div>
          ${cells}
        </div>

        ${legend}
      </div>

      ${detailHTML}
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
  textFilter: '',

  render() {
    const props   = Store.get(KEYS.properties)
    let tenants = this.propFilter ? Store.where(KEYS.tenants, 'propertyId', this.propFilter) : Store.get(KEYS.tenants)
    if (this.textFilter) {
      tenants = tenants.filter(t => matchesText(
        `${t.firstName} ${t.lastName} ${t.email} ${t.phone} ${t.status} ${propName(t.propertyId)}`,
        this.textFilter
      ))
    }

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
        ${filterSearchHTML('tenants', 'Search tenants…')}
        <select onchange="Pages.tenants.propFilter=this.value;Pages.tenants.render()">
          <option value="">All Properties</option>
          ${props.map(p => `<option value="${p.id}"${this.propFilter===p.id?' selected':''}>${esc(p.name)}</option>`).join('')}
        </select>
        ${this.propFilter||this.textFilter ? `<button class="btn btn-secondary btn-sm" onclick="Pages.tenants.propFilter='';Pages.tenants.textFilter='';Pages.tenants.render()">Clear</button>` : ''}
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
  textFilter:  '',

  render() {
    const props = Store.get(KEYS.properties)
    let pmts = Store.get(KEYS.payments)
    if (this.propFilter)  pmts = pmts.filter(p => p.propertyId === this.propFilter)
    if (this.monthFilter) pmts = pmts.filter(p => p.month === this.monthFilter)
    if (this.textFilter)  pmts = pmts.filter(p => matchesText(
      `${tenantName(p.tenantId)} ${propName(p.propertyId)} ${p.method || ''} ${p.status} ${fmt.currency(p.amount)}`,
      this.textFilter
    ))
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
        ${filterSearchHTML('payments', 'Search payments…')}
        <select onchange="Pages.payments.propFilter=this.value;Pages.payments.render()">
          <option value="">All Properties</option>
          ${props.map(p => `<option value="${p.id}"${this.propFilter===p.id?' selected':''}>${esc(p.name)}</option>`).join('')}
        </select>
        <input type="month" value="${this.monthFilter}" onchange="Pages.payments.monthFilter=this.value;Pages.payments.render()" style="width:auto;min-width:150px">
        ${this.propFilter||this.monthFilter||this.textFilter ? `<button class="btn btn-secondary btn-sm" onclick="Pages.payments.propFilter='';Pages.payments.monthFilter='';Pages.payments.textFilter='';Pages.payments.render()">Clear</button>` : ''}
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
  textFilter: '',
  statusFilter: '',

  render() {
    const props = Store.get(KEYS.properties)
    const ORDER = { high: 0, medium: 1, low: 2 }
    let items = this.propFilter ? Store.where(KEYS.outstanding, 'propertyId', this.propFilter) : Store.get(KEYS.outstanding)
    if (this.statusFilter) items = items.filter(i => i.status === this.statusFilter)
    if (this.textFilter) items = items.filter(i => matchesText(
      `${i.title} ${i.description || ''} ${i.priority} ${propName(i.propertyId)}`,
      this.textFilter
    ))
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
        ${filterSearchHTML('outstanding', 'Search items…')}
        <select onchange="Pages.outstanding.propFilter=this.value;Pages.outstanding.render()">
          <option value="">All Properties</option>
          ${props.map(p => `<option value="${p.id}"${this.propFilter===p.id?' selected':''}>${esc(p.name)}</option>`).join('')}
        </select>
        <select onchange="Pages.outstanding.statusFilter=this.value;Pages.outstanding.render()">
          <option value="">All Statuses</option>
          <option value="open"${this.statusFilter==='open'?' selected':''}>Open</option>
          <option value="in-progress"${this.statusFilter==='in-progress'?' selected':''}>In Progress</option>
          <option value="resolved"${this.statusFilter==='resolved'?' selected':''}>Resolved</option>
        </select>
        ${this.propFilter||this.textFilter||this.statusFilter ? `<button class="btn btn-secondary btn-sm" onclick="Pages.outstanding.propFilter='';Pages.outstanding.textFilter='';Pages.outstanding.statusFilter='';Pages.outstanding.render()">Clear</button>` : ''}
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
  textFilter: '',
  statusFilter: '',

  render() {
    const props = Store.get(KEYS.properties)
    let repairs = this.propFilter ? Store.where(KEYS.repairs, 'propertyId', this.propFilter) : Store.get(KEYS.repairs)
    if (this.statusFilter) repairs = repairs.filter(r => r.status === this.statusFilter)
    if (this.textFilter) repairs = repairs.filter(r => matchesText(
      `${r.title} ${r.description || ''} ${r.vendor || ''} ${propName(r.propertyId)}`,
      this.textFilter
    ))
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
        ${filterSearchHTML('repairs', 'Search repairs…')}
        <select onchange="Pages.repairs.propFilter=this.value;Pages.repairs.render()">
          <option value="">All Properties</option>
          ${props.map(p => `<option value="${p.id}"${this.propFilter===p.id?' selected':''}>${esc(p.name)}</option>`).join('')}
        </select>
        <select onchange="Pages.repairs.statusFilter=this.value;Pages.repairs.render()">
          <option value="">All Statuses</option>
          <option value="reported"${this.statusFilter==='reported'?' selected':''}>Reported</option>
          <option value="scheduled"${this.statusFilter==='scheduled'?' selected':''}>Scheduled</option>
          <option value="in-progress"${this.statusFilter==='in-progress'?' selected':''}>In Progress</option>
          <option value="completed"${this.statusFilter==='completed'?' selected':''}>Completed</option>
        </select>
        ${this.propFilter||this.textFilter||this.statusFilter ? `<button class="btn btn-secondary btn-sm" onclick="Pages.repairs.propFilter='';Pages.repairs.textFilter='';Pages.repairs.statusFilter='';Pages.repairs.render()">Clear</button>` : ''}
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
  textFilter: '',

  render() {
    const props = Store.get(KEYS.properties)
    let expenses = Store.get(KEYS.expenses)
    if (this.propFilter) expenses = expenses.filter(e => e.propertyId === this.propFilter)
    if (this.catFilter)  expenses = expenses.filter(e => e.category   === this.catFilter)
    if (this.textFilter) expenses = expenses.filter(e => matchesText(
      `${e.description} ${e.category} ${e.notes || ''} ${propName(e.propertyId)}`,
      this.textFilter
    ))
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
        ${filterSearchHTML('expenses', 'Search expenses…')}
        <select onchange="Pages.expenses.propFilter=this.value;Pages.expenses.render()">
          <option value="">All Properties</option>
          ${props.map(p => `<option value="${p.id}"${this.propFilter===p.id?' selected':''}>${esc(p.name)}</option>`).join('')}
        </select>
        <select onchange="Pages.expenses.catFilter=this.value;Pages.expenses.render()">
          <option value="">All Categories</option>
          ${EXPENSE_CATS.map(c => `<option value="${c}"${this.catFilter===c?' selected':''}>${capitalize(c)}</option>`).join('')}
        </select>
        ${this.propFilter||this.catFilter||this.textFilter ? `<button class="btn btn-secondary btn-sm" onclick="Pages.expenses.propFilter='';Pages.expenses.catFilter='';Pages.expenses.textFilter='';Pages.expenses.render()">Clear</button>` : ''}
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
//  Global Search (⌘K)
// ============================================================

const Search = {
  _idx: -1,   // active result index for keyboard nav
  _items: [], // current result elements

  open() {
    $('search-overlay').classList.remove('hidden')
    document.body.style.overflow = 'hidden'
    const inp = $('search-input')
    inp.value = ''
    inp.focus()
    this._renderHint()
  },

  close() {
    $('search-overlay').classList.add('hidden')
    document.body.style.overflow = ''
    this._idx = -1
    this._items = []
  },

  _renderHint() {
    $('search-results').innerHTML = `
      <div class="search-hint">
        Type to search across properties, tenants, payments, repairs, expenses &amp; outstanding items.
      </div>
    `
  },

  _highlight(text, query) {
    if (!query) return esc(text)
    const escaped = esc(text)
    const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    return escaped.replace(re, '<span class="search-hl">$1</span>')
  },

  run(query) {
    if (!query.trim()) { this._renderHint(); this._idx = -1; this._items = []; return }
    const q = query.toLowerCase().trim()
    const results = []

    // Search properties
    Store.get(KEYS.properties).forEach(p => {
      const hay = `${p.name} ${p.address} ${p.type} ${p.status}`.toLowerCase()
      if (hay.includes(q)) {
        results.push({
          type: 'prop', icon: '🏠', iconCls: 'prop',
          title: p.name, sub: p.address,
          badge: badge(p.status),
          action: () => { this.close(); Router.go('properties') }
        })
      }
    })

    // Search tenants
    Store.get(KEYS.tenants).forEach(t => {
      const hay = `${t.firstName} ${t.lastName} ${t.email} ${t.phone}`.toLowerCase()
      if (hay.includes(q)) {
        results.push({
          type: 'tenant', icon: '👤', iconCls: 'tenant',
          title: `${t.firstName} ${t.lastName}`, sub: `${propName(t.propertyId)} · ${t.email}`,
          badge: badge(t.status),
          action: () => { this.close(); Pages.tenants.propFilter = ''; Router.go('tenants') }
        })
      }
    })

    // Search payments
    Store.get(KEYS.payments).forEach(p => {
      const tName = tenantName(p.tenantId)
      const pName = propName(p.propertyId)
      const hay = `${tName} ${pName} ${p.method || ''} ${p.status} ${p.month}`.toLowerCase()
      if (hay.includes(q)) {
        results.push({
          type: 'payment', icon: '💰', iconCls: 'payment',
          title: `${fmt.currency(p.amount)} — ${tName}`, sub: `${pName} · ${fmt.monthLabel(p.month)}`,
          badge: badge(p.status),
          action: () => { this.close(); Pages.payments.propFilter = ''; Pages.payments.monthFilter = ''; Router.go('payments') }
        })
      }
    })

    // Search repairs
    Store.get(KEYS.repairs).forEach(r => {
      const hay = `${r.title} ${r.description || ''} ${r.vendor || ''} ${r.status}`.toLowerCase()
      if (hay.includes(q)) {
        results.push({
          type: 'repair', icon: '🔧', iconCls: 'repair',
          title: r.title, sub: `${propName(r.propertyId)} · ${r.vendor || 'No vendor'}`,
          badge: badge(r.status),
          action: () => { this.close(); Pages.repairs.propFilter = ''; Router.go('repairs') }
        })
      }
    })

    // Search outstanding items
    Store.get(KEYS.outstanding).forEach(o => {
      const hay = `${o.title} ${o.description || ''} ${o.status} ${o.priority}`.toLowerCase()
      if (hay.includes(q)) {
        results.push({
          type: 'item', icon: '📋', iconCls: 'item',
          title: o.title, sub: propName(o.propertyId),
          badge: badge(o.status),
          action: () => { this.close(); Pages.outstanding.propFilter = ''; Router.go('outstanding') }
        })
      }
    })

    // Search expenses
    Store.get(KEYS.expenses).forEach(e => {
      const hay = `${e.description} ${e.category} ${e.notes || ''}`.toLowerCase()
      if (hay.includes(q)) {
        results.push({
          type: 'expense', icon: '🧾', iconCls: 'expense',
          title: e.description, sub: `${propName(e.propertyId)} · ${capitalize(e.category)} · ${fmt.currency(e.amount)}`,
          badge: '',
          action: () => { this.close(); Pages.expenses.propFilter = ''; Pages.expenses.catFilter = ''; Router.go('expenses') }
        })
      }
    })

    this._renderResults(results, query)
  },

  _renderResults(results, query) {
    const container = $('search-results')
    if (!results.length) {
      container.innerHTML = `
        <div class="search-empty">
          <div class="search-empty-icon">🔍</div>
          No results for "${esc(query)}"
        </div>
      `
      this._idx = -1; this._items = []
      return
    }

    // Group by type
    const groups = {}
    const labels = { prop: 'Properties', tenant: 'Tenants', payment: 'Payments', repair: 'Repairs', item: 'Outstanding Items', expense: 'Expenses' }
    results.forEach(r => {
      if (!groups[r.type]) groups[r.type] = []
      groups[r.type].push(r)
    })

    let html = ''
    let idx = 0
    for (const [type, items] of Object.entries(groups)) {
      html += `<div class="search-group-label">${labels[type] || type} (${items.length})</div>`
      items.slice(0, 5).forEach(item => {
        html += `
          <button class="search-item" data-idx="${idx}" onclick="Search._go(${idx})">
            <div class="search-item-icon ${item.iconCls}">${item.icon}</div>
            <div class="search-item-text">
              <div class="search-item-title">${this._highlight(item.title, query)}</div>
              <div class="search-item-sub">${this._highlight(item.sub, query)}</div>
            </div>
            <div class="search-item-badge">${item.badge}</div>
          </button>
        `
        idx++
      })
    }

    container.innerHTML = html
    this._items = results.slice(0, idx)
    this._idx = -1
  },

  _go(idx) {
    const item = this._items[idx]
    if (item && item.action) item.action()
  },

  _navigate(dir) {
    const items = $('search-results').querySelectorAll('.search-item')
    if (!items.length) return
    items.forEach(el => el.classList.remove('active'))
    this._idx += dir
    if (this._idx < 0) this._idx = items.length - 1
    if (this._idx >= items.length) this._idx = 0
    items[this._idx].classList.add('active')
    items[this._idx].scrollIntoView({ block: 'nearest' })
  },

  _enter() {
    if (this._idx >= 0 && this._items[this._idx]) {
      this._items[this._idx].action()
    }
  }
}

// ============================================================
//  Filter Search Helper
// ============================================================

function filterSearchHTML(pageKey, placeholder = 'Search…') {
  return `
    <div class="filter-search">
      <svg class="filter-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input type="text" placeholder="${placeholder}" value="${esc(Pages[pageKey].textFilter || '')}"
             oninput="Pages.${pageKey}.textFilter=this.value;Pages.${pageKey}.render()">
      ${Pages[pageKey].textFilter ? `<button class="filter-clear" onclick="Pages.${pageKey}.textFilter='';Pages.${pageKey}.render()" title="Clear search">✕</button>` : ''}
    </div>
  `
}

function matchesText(haystack, query) {
  if (!query) return true
  return haystack.toLowerCase().includes(query.toLowerCase().trim())
}

// ============================================================
//  Boot
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  // --- Global Search wiring ---
  const searchInput = $('search-input')
  searchInput.addEventListener('input', () => Search.run(searchInput.value))
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown')  { e.preventDefault(); Search._navigate(1) }
    if (e.key === 'ArrowUp')    { e.preventDefault(); Search._navigate(-1) }
    if (e.key === 'Enter')      { e.preventDefault(); Search._enter() }
    if (e.key === 'Escape')     { Search.close() }
  })

  // ⌘K / Ctrl+K to open search, Escape to close
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      Search.open()
    }
    if (e.key === 'Escape') {
      if (!$('search-overlay').classList.contains('hidden')) Search.close()
      else if (!$('panel-overlay').classList.contains('hidden')) Panel.close()
    }
  })

  // Render immediately from local cache (instant first paint)
  Router.go('dashboard')

  // Then seed if needed, sync from Supabase, and setup realtime
  try {
    await seed()
    await syncFromSupabase()
    setupRealtime()
    console.log('✅ Supabase connected — real-time sync active')
  } catch (err) {
    console.warn('⚠️ Supabase sync failed, using local cache:', err.message)
  }
})
