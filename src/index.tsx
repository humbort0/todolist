import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

// ===== DB Init helper =====
async function ensureDB(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#5EEAD4',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      teacher_id INTEGER NOT NULL,
      category_id INTEGER,
      progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
      due_date TEXT,
      is_private INTEGER DEFAULT 0,
      is_approved INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (teacher_id) REFERENCES teachers(id),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      todo_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE
    )`)
  ])
}

// ===== Auth API =====
app.post('/api/auth/login', async (c) => {
  const { password } = await c.req.json()
  if (password === '0000') {
    return c.json({ success: true, role: 'user' })
  }
  if (password === '1026') {
    return c.json({ success: true, role: 'admin' })
  }
  return c.json({ success: false, message: '비밀번호가 올바르지 않습니다.' }, 401)
})

app.post('/api/auth/admin', async (c) => {
  const { password } = await c.req.json()
  if (password === '1026') {
    return c.json({ success: true, role: 'admin' })
  }
  return c.json({ success: false, message: '관리자 비밀번호가 올바르지 않습니다.' }, 401)
})

// ===== Teachers API =====
app.get('/api/teachers', async (c) => {
  await ensureDB(c.env.DB)
  const { results } = await c.env.DB.prepare('SELECT * FROM teachers WHERE is_active = 1 ORDER BY name').all()
  return c.json(results)
})

app.post('/api/teachers', async (c) => {
  const { name } = await c.req.json()
  await ensureDB(c.env.DB)
  const result = await c.env.DB.prepare('INSERT INTO teachers (name) VALUES (?)').bind(name).run()
  return c.json({ id: result.meta.last_row_id, name })
})

app.delete('/api/teachers/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE teachers SET is_active = 0 WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ===== Categories API =====
app.get('/api/categories', async (c) => {
  await ensureDB(c.env.DB)
  const { results } = await c.env.DB.prepare('SELECT * FROM categories ORDER BY name').all()
  return c.json(results)
})

app.post('/api/categories', async (c) => {
  const { name, color } = await c.req.json()
  await ensureDB(c.env.DB)
  const result = await c.env.DB.prepare('INSERT INTO categories (name, color) VALUES (?, ?)').bind(name, color || '#5EEAD4').run()
  return c.json({ id: result.meta.last_row_id, name, color })
})

app.put('/api/categories/:id', async (c) => {
  const id = c.req.param('id')
  const { name, color } = await c.req.json()
  await c.env.DB.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?').bind(name, color, id).run()
  return c.json({ success: true })
})

app.delete('/api/categories/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ===== Todos API =====
app.get('/api/todos', async (c) => {
  await ensureDB(c.env.DB)
  const isAdmin = c.req.query('admin') === 'true'
  const search = c.req.query('search') || ''
  const period = c.req.query('period') || 'all'
  const teacherId = c.req.query('teacher_id') || ''
  const categoryId = c.req.query('category_id') || ''

  let query = `
    SELECT t.*, 
      te.name as teacher_name, 
      c.name as category_name, 
      c.color as category_color,
      (SELECT COUNT(*) FROM comments cm WHERE cm.todo_id = t.id) as comment_count
    FROM todos t
    LEFT JOIN teachers te ON t.teacher_id = te.id
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE 1=1
  `
  const bindings: any[] = []

  if (!isAdmin) {
    query += ' AND t.is_private = 0'
  }

  if (search) {
    query += ' AND (t.title LIKE ? OR t.description LIKE ? OR te.name LIKE ? OR c.name LIKE ?)'
    const s = `%${search}%`
    bindings.push(s, s, s, s)
  }

  if (teacherId) {
    query += ' AND t.teacher_id = ?'
    bindings.push(teacherId)
  }

  if (categoryId) {
    query += ' AND t.category_id = ?'
    bindings.push(categoryId)
  }

  if (period === 'day') {
    query += " AND t.due_date = date('now')"
  } else if (period === 'week') {
    query += " AND t.due_date BETWEEN date('now') AND date('now', '+7 days')"
  } else if (period === 'month') {
    query += " AND t.due_date BETWEEN date('now') AND date('now', '+30 days')"
  }

  query += ' ORDER BY t.due_date ASC, t.created_at DESC'

  let stmt = c.env.DB.prepare(query)
  if (bindings.length > 0) {
    stmt = stmt.bind(...bindings)
  }
  const { results } = await stmt.all()
  return c.json(results)
})

app.post('/api/todos', async (c) => {
  const body = await c.req.json()
  await ensureDB(c.env.DB)
  const result = await c.env.DB.prepare(
    'INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(
    body.title,
    body.description || '',
    body.teacher_id,
    body.category_id || null,
    body.progress || 0,
    body.due_date || null
  ).run()
  return c.json({ id: result.meta.last_row_id, ...body })
})

app.put('/api/todos/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  
  const sets: string[] = []
  const vals: any[] = []

  if (body.title !== undefined) { sets.push('title = ?'); vals.push(body.title) }
  if (body.description !== undefined) { sets.push('description = ?'); vals.push(body.description) }
  if (body.teacher_id !== undefined) { sets.push('teacher_id = ?'); vals.push(body.teacher_id) }
  if (body.category_id !== undefined) { sets.push('category_id = ?'); vals.push(body.category_id) }
  if (body.progress !== undefined) { sets.push('progress = ?'); vals.push(body.progress) }
  if (body.due_date !== undefined) { sets.push('due_date = ?'); vals.push(body.due_date) }
  if (body.is_private !== undefined) { sets.push('is_private = ?'); vals.push(body.is_private ? 1 : 0) }
  if (body.is_approved !== undefined) { sets.push('is_approved = ?'); vals.push(body.is_approved ? 1 : 0) }

  sets.push("updated_at = datetime('now')")
  vals.push(id)

  await c.env.DB.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
  return c.json({ success: true })
})

app.delete('/api/todos/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM todos WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ===== Comments API =====
app.get('/api/todos/:id/comments', async (c) => {
  const todoId = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM comments WHERE todo_id = ? ORDER BY created_at DESC'
  ).bind(todoId).all()
  return c.json(results)
})

app.post('/api/todos/:id/comments', async (c) => {
  const todoId = c.req.param('id')
  const { content } = await c.req.json()
  const result = await c.env.DB.prepare(
    'INSERT INTO comments (todo_id, content) VALUES (?, ?)'
  ).bind(todoId, content).run()
  return c.json({ id: result.meta.last_row_id, todo_id: todoId, content })
})

app.delete('/api/comments/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ===== Dashboard Stats API =====
app.get('/api/stats', async (c) => {
  await ensureDB(c.env.DB)
  const isAdmin = c.req.query('admin') === 'true'

  let whereClause = isAdmin ? '' : 'WHERE is_private = 0'

  const total = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM todos ${whereClause}`).first()
  const inProgress = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM todos ${whereClause ? whereClause + ' AND' : 'WHERE'} progress > 0 AND progress < 100`).first()
  const waitingApproval = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM todos ${whereClause ? whereClause + ' AND' : 'WHERE'} progress = 100 AND is_approved = 0`).first()
  const avgProgress = await c.env.DB.prepare(`SELECT AVG(progress) as avg FROM todos ${whereClause}`).first()

  return c.json({
    total: total?.count || 0,
    inProgress: inProgress?.count || 0,
    waitingApproval: waitingApproval?.count || 0,
    avgProgress: Math.round(Number(avgProgress?.avg || 0))
  })
})

// ===== Seed data endpoint =====
app.post('/api/seed', async (c) => {
  await ensureDB(c.env.DB)
  
  // Check if data already exists
  const existing = await c.env.DB.prepare('SELECT COUNT(*) as count FROM teachers').first()
  if (existing && Number(existing.count) > 0) {
    return c.json({ message: 'Data already seeded' })
  }

  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO teachers (name) VALUES ('김민수')"),
    c.env.DB.prepare("INSERT INTO teachers (name) VALUES ('이영희')"),
    c.env.DB.prepare("INSERT INTO teachers (name) VALUES ('박지훈')"),
    c.env.DB.prepare("INSERT INTO teachers (name) VALUES ('최수연')"),
    c.env.DB.prepare("INSERT INTO teachers (name) VALUES ('정대호')"),
  ])

  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO categories (name, color) VALUES ('기획', '#5EEAD4')"),
    c.env.DB.prepare("INSERT INTO categories (name, color) VALUES ('창체', '#FCA5A5')"),
    c.env.DB.prepare("INSERT INTO categories (name, color) VALUES ('교육과정', '#93C5FD')"),
    c.env.DB.prepare("INSERT INTO categories (name, color) VALUES ('행정', '#FDE68A')"),
    c.env.DB.prepare("INSERT INTO categories (name, color) VALUES ('연수', '#C4B5FD')"),
  ])

  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date) VALUES ('2026 교육과정 편성안 작성', '학년별 교육과정 편성안을 작성하고 검토합니다.', 1, 3, 75, '2026-04-15')"),
    c.env.DB.prepare("INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date) VALUES ('창의적 체험활동 계획서', '1학기 창체 활동 세부 계획을 수립합니다.', 2, 2, 40, '2026-04-10')"),
    c.env.DB.prepare("INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date) VALUES ('학부모 총회 준비', '학부모 총회 자료 및 발표 준비를 합니다.', 3, 1, 100, '2026-03-28')"),
    c.env.DB.prepare("INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date) VALUES ('교원 연수 일정 수립', '상반기 교원 연수 일정을 확정합니다.', 4, 5, 20, '2026-04-05')"),
    c.env.DB.prepare("INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date) VALUES ('예산 집행 현황 정리', '1분기 예산 집행 현황을 정리합니다.', 5, 4, 60, '2026-04-20')"),
    c.env.DB.prepare("INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date) VALUES ('학교 홈페이지 업데이트', '최신 공지사항 및 갤러리를 업데이트합니다.', 1, 4, 30, '2026-03-30')"),
    c.env.DB.prepare("INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date) VALUES ('방과후학교 프로그램 기획', '2학기 방과후학교 프로그램을 기획합니다.', 2, 1, 10, '2026-05-01')"),
    c.env.DB.prepare("INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date) VALUES ('안전교육 실시 보고서', '3월 안전교육 실시 결과를 보고합니다.', 3, 3, 90, '2026-03-31')"),
  ])

  return c.json({ message: 'Seed data inserted successfully' })
})

// ===== Serve SPA =====
app.get('/', async (c) => {
  return c.html(getIndexHTML())
})

app.get('*', async (c) => {
  // Serve static files or fallback to SPA
  const path = c.req.path
  if (path.startsWith('/api/')) {
    return c.json({ error: 'Not found' }, 404)
  }
  return c.html(getIndexHTML())
})

function getIndexHTML(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>To-Do-List | TDL</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            mint: { 50:'#f0fdfa', 100:'#ccfbf1', 200:'#99f6e4', 300:'#5eead4', 400:'#2dd4bf', 500:'#14b8a6', 600:'#0d9488', 700:'#0f766e', 800:'#115e59', 900:'#134e4a' },
            peach: { 50:'#fff7ed', 100:'#ffedd5', 200:'#fed7aa', 300:'#fdba74' },
            slate2: { 50:'#f8fafc', 100:'#f1f5f9', 200:'#e2e8f0' }
          }
        }
      }
    }
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&display=swap');
    * { font-family: 'Noto Sans KR', sans-serif; }
    input[type="range"] { -webkit-appearance: none; appearance: none; height: 8px; border-radius: 4px; outline: none; }
    input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 20px; height: 20px; border-radius: 50%; background: #14b8a6; cursor: pointer; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
    input[type="range"]::-moz-range-thumb { width: 20px; height: 20px; border-radius: 50%; background: #14b8a6; cursor: pointer; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
    .fade-in { animation: fadeIn 0.3s ease-in; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
    .slider-bg { background: linear-gradient(to right, #99f6e4 0%, #14b8a6 50%, #0d9488 100%); }
    .dark .card-bg { background-color: #1e293b; }
    .dark body { background-color: #0f172a; color: #e2e8f0; }
    .modal-overlay { background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); }
    .tooltip { position: relative; }
    .tooltip:hover::after { content: attr(data-tip); position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: #1e293b; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; white-space: nowrap; z-index: 50; }
    @media (max-width: 768px) {
      .mobile-title::after { content: 'TDL'; }
      .mobile-title span { display: none; }
      .desktop-title { display: none; }
    }
    @media (min-width: 769px) {
      .mobile-title::after { content: none; }
    }
  </style>
</head>
<body class="bg-gray-50 min-h-screen transition-colors duration-300">

  <!-- Login Screen -->
  <div id="loginScreen" class="min-h-screen flex items-center justify-center bg-gradient-to-br from-mint-100 to-mint-200">
    <div class="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md mx-4 fade-in">
      <div class="text-center mb-8">
        <div class="w-20 h-20 bg-mint-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <i class="fas fa-clipboard-check text-white text-3xl"></i>
        </div>
        <h1 class="text-2xl font-bold text-gray-800">To-Do-List</h1>
        <p class="text-gray-500 mt-2 text-sm">부서 업무 관리 시스템</p>
      </div>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-600 mb-2">비밀번호를 입력하세요</label>
          <input id="loginPassword" type="password" placeholder="비밀번호 입력" 
            class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mint-400 focus:border-transparent outline-none transition"
            onkeydown="if(event.key==='Enter')handleLogin()">
        </div>
        <button onclick="handleLogin()" class="w-full bg-mint-500 hover:bg-mint-600 text-white font-semibold py-3 rounded-xl transition-all duration-200 shadow-lg shadow-mint-200">
          <i class="fas fa-sign-in-alt mr-2"></i>로그인
        </button>
        <p id="loginError" class="text-red-500 text-sm text-center hidden"></p>
        <p class="text-xs text-gray-400 text-center">일반: 0000 / 관리자: 1026</p>
      </div>
    </div>
  </div>

  <!-- Main App -->
  <div id="mainApp" class="hidden">
    <!-- Top Nav Bar -->
    <nav class="bg-gradient-to-r from-mint-600 to-mint-500 text-white shadow-lg sticky top-0 z-40">
      <div class="max-w-7xl mx-auto px-4 py-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-3">
            <div class="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center">
              <i class="fas fa-clipboard-check text-lg"></i>
            </div>
            <div>
              <h1 class="font-bold text-lg leading-tight">
                <span class="hidden md:inline">To-Do-List</span>
                <span class="md:hidden">TDL</span>
              </h1>
              <p class="text-mint-100 text-xs hidden sm:block">부서 업무 관리</p>
            </div>
          </div>
          
          <div class="flex items-center space-x-2 sm:space-x-3">
            <!-- Search -->
            <div class="relative hidden sm:block">
              <input id="searchInput" type="text" placeholder="검색..." 
                class="bg-white/20 text-white placeholder-white/60 px-4 py-2 rounded-lg text-sm w-48 focus:w-64 transition-all focus:bg-white/30 outline-none"
                oninput="handleSearch()">
              <i class="fas fa-search absolute right-3 top-2.5 text-white/60 text-sm"></i>
            </div>
            <!-- Mobile Search Toggle -->
            <button onclick="toggleMobileSearch()" class="sm:hidden p-2 hover:bg-white/20 rounded-lg transition">
              <i class="fas fa-search"></i>
            </button>
            <!-- Dark Mode -->
            <button onclick="toggleDarkMode()" class="p-2 hover:bg-white/20 rounded-lg transition tooltip" data-tip="다크모드">
              <i id="darkModeIcon" class="fas fa-moon"></i>
            </button>
            <!-- Admin Badge -->
            <span id="adminBadge" class="hidden bg-yellow-400 text-yellow-900 px-3 py-1 rounded-full text-xs font-bold">
              <i class="fas fa-shield-alt mr-1"></i>관리자
            </span>
            <!-- Admin Toggle -->
            <button id="adminToggleBtn" onclick="showAdminLogin()" class="p-2 hover:bg-white/20 rounded-lg transition tooltip" data-tip="관리자 모드">
              <i class="fas fa-cog"></i>
            </button>
            <!-- Logout -->
            <button onclick="handleLogout()" class="p-2 hover:bg-white/20 rounded-lg transition tooltip" data-tip="로그아웃">
              <i class="fas fa-sign-out-alt"></i>
            </button>
          </div>
        </div>
        <!-- Mobile Search Bar -->
        <div id="mobileSearch" class="hidden mt-3 sm:hidden">
          <input id="mobileSearchInput" type="text" placeholder="업무, 담당자, 카테고리 검색..." 
            class="w-full bg-white/20 text-white placeholder-white/60 px-4 py-2 rounded-lg text-sm focus:bg-white/30 outline-none"
            oninput="handleMobileSearch()">
        </div>
      </div>
    </nav>

    <!-- Dashboard Content -->
    <div class="max-w-7xl mx-auto px-4 py-6">
      
      <!-- Summary Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div class="bg-mint-50 border border-mint-100 rounded-2xl p-5 hover:shadow-lg transition-shadow dark:bg-slate-800 dark:border-slate-700">
          <div class="flex items-center justify-between mb-3">
            <div class="w-10 h-10 bg-mint-200 rounded-xl flex items-center justify-center">
              <i class="fas fa-list-check text-mint-700"></i>
            </div>
            <span class="text-xs text-mint-600 font-medium bg-mint-100 px-2 py-1 rounded-full dark:bg-slate-700 dark:text-mint-400">전체</span>
          </div>
          <p id="statTotal" class="text-3xl font-bold text-gray-800 dark:text-white">0</p>
          <p class="text-sm text-gray-500 dark:text-gray-400">전체 할 일</p>
        </div>
        <div class="bg-peach-50 border border-orange-100 rounded-2xl p-5 hover:shadow-lg transition-shadow dark:bg-slate-800 dark:border-slate-700">
          <div class="flex items-center justify-between mb-3">
            <div class="w-10 h-10 bg-orange-200 rounded-xl flex items-center justify-center">
              <i class="fas fa-spinner text-orange-700"></i>
            </div>
            <span class="text-xs text-orange-600 font-medium bg-orange-100 px-2 py-1 rounded-full dark:bg-slate-700 dark:text-orange-400">진행</span>
          </div>
          <p id="statInProgress" class="text-3xl font-bold text-gray-800 dark:text-white">0</p>
          <p class="text-sm text-gray-500 dark:text-gray-400">진행 중</p>
        </div>
        <div class="bg-gray-50 border border-gray-200 rounded-2xl p-5 hover:shadow-lg transition-shadow dark:bg-slate-800 dark:border-slate-700">
          <div class="flex items-center justify-between mb-3">
            <div class="w-10 h-10 bg-gray-200 rounded-xl flex items-center justify-center">
              <i class="fas fa-hourglass-half text-gray-600"></i>
            </div>
            <span class="text-xs text-gray-600 font-medium bg-gray-200 px-2 py-1 rounded-full dark:bg-slate-700 dark:text-gray-400">대기</span>
          </div>
          <p id="statWaiting" class="text-3xl font-bold text-gray-800 dark:text-white">0</p>
          <p class="text-sm text-gray-500 dark:text-gray-400">완료 대기</p>
        </div>
        <div class="bg-blue-50 border border-blue-100 rounded-2xl p-5 hover:shadow-lg transition-shadow dark:bg-slate-800 dark:border-slate-700">
          <div class="flex items-center justify-between mb-3">
            <div class="w-10 h-10 bg-blue-200 rounded-xl flex items-center justify-center">
              <i class="fas fa-chart-pie text-blue-700"></i>
            </div>
            <span class="text-xs text-blue-600 font-medium bg-blue-100 px-2 py-1 rounded-full dark:bg-slate-700 dark:text-blue-400">진행률</span>
          </div>
          <p id="statAvgProgress" class="text-3xl font-bold text-gray-800 dark:text-white">0%</p>
          <p class="text-sm text-gray-500 dark:text-gray-400">평균 진행률</p>
        </div>
      </div>

      <!-- Filter & Action Bar -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-6 dark:bg-slate-800 dark:border-slate-700">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <!-- Period Filter -->
            <div class="flex bg-gray-100 rounded-lg p-1 dark:bg-slate-700">
              <button onclick="setPeriod('all')" id="periodAll" class="px-3 py-1.5 rounded-md text-sm font-medium transition-all bg-mint-500 text-white">전체</button>
              <button onclick="setPeriod('day')" id="periodDay" class="px-3 py-1.5 rounded-md text-sm font-medium transition-all text-gray-600 hover:text-gray-800 dark:text-gray-300">당일</button>
              <button onclick="setPeriod('week')" id="periodWeek" class="px-3 py-1.5 rounded-md text-sm font-medium transition-all text-gray-600 hover:text-gray-800 dark:text-gray-300">주별</button>
              <button onclick="setPeriod('month')" id="periodMonth" class="px-3 py-1.5 rounded-md text-sm font-medium transition-all text-gray-600 hover:text-gray-800 dark:text-gray-300">월별</button>
            </div>
            <!-- Teacher Filter -->
            <select id="filterTeacher" onchange="loadTodos()" class="px-3 py-2 border border-gray-200 rounded-lg text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-white">
              <option value="">모든 담당자</option>
            </select>
            <!-- Category Filter -->
            <select id="filterCategory" onchange="loadTodos()" class="px-3 py-2 border border-gray-200 rounded-lg text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-white">
              <option value="">모든 업무구분</option>
            </select>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="exportExcel()" class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
              <i class="fas fa-file-excel mr-1"></i>
              <span class="hidden sm:inline">엑셀 다운로드</span>
              <span class="sm:hidden">엑셀</span>
            </button>
            <button id="addTodoBtn" onclick="showAddTodoModal()" class="bg-mint-500 hover:bg-mint-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
              <i class="fas fa-plus mr-1"></i>
              <span class="hidden sm:inline">할 일 추가</span>
              <span class="sm:hidden">추가</span>
            </button>
            <!-- Admin Management Button -->
            <button id="adminMgmtBtn" onclick="showAdminPanel()" class="hidden bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
              <i class="fas fa-users-cog mr-1"></i>
              <span class="hidden sm:inline">관리</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Todo List -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden dark:bg-slate-800 dark:border-slate-700">
        <!-- Table Header (Desktop) -->
        <div class="hidden md:grid grid-cols-12 gap-2 px-6 py-3 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider dark:bg-slate-900 dark:border-slate-700 dark:text-gray-400">
          <div class="col-span-1">구분</div>
          <div class="col-span-3">업무명</div>
          <div class="col-span-1">담당자</div>
          <div class="col-span-1">기한</div>
          <div class="col-span-3">진행률</div>
          <div class="col-span-1">상태</div>
          <div class="col-span-2 text-right">작업</div>
        </div>
        
        <!-- Todo Items Container -->
        <div id="todoList" class="divide-y divide-gray-50 dark:divide-slate-700">
          <div class="p-8 text-center text-gray-400">
            <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
            <p>로딩 중...</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Add/Edit Todo Modal -->
  <div id="todoModal" class="fixed inset-0 z-50 hidden">
    <div class="modal-overlay absolute inset-0" onclick="closeTodoModal()"></div>
    <div class="relative flex items-center justify-center min-h-screen p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 relative z-10 fade-in dark:bg-slate-800">
        <h3 id="todoModalTitle" class="text-lg font-bold text-gray-800 mb-4 dark:text-white">
          <i class="fas fa-plus-circle text-mint-500 mr-2"></i>새 할 일 추가
        </h3>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1 dark:text-gray-300">업무명 *</label>
            <input id="todoTitle" type="text" class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-mint-400 outline-none dark:bg-slate-700 dark:border-slate-600 dark:text-white" placeholder="업무명 입력">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1 dark:text-gray-300">상세 설명</label>
            <textarea id="todoDesc" rows="2" class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-mint-400 outline-none dark:bg-slate-700 dark:border-slate-600 dark:text-white" placeholder="업무 설명"></textarea>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-600 mb-1 dark:text-gray-300">담당자 *</label>
              <select id="todoTeacher" class="w-full px-3 py-2 border border-gray-200 rounded-lg dark:bg-slate-700 dark:border-slate-600 dark:text-white">
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-600 mb-1 dark:text-gray-300">업무 구분</label>
              <select id="todoCategory" class="w-full px-3 py-2 border border-gray-200 rounded-lg dark:bg-slate-700 dark:border-slate-600 dark:text-white">
                <option value="">선택 안함</option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1 dark:text-gray-300">마감 기한</label>
            <input id="todoDueDate" type="date" class="w-full px-3 py-2 border border-gray-200 rounded-lg dark:bg-slate-700 dark:border-slate-600 dark:text-white">
          </div>
        </div>
        <div class="flex justify-end space-x-3 mt-6">
          <button onclick="closeTodoModal()" class="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium dark:text-gray-300">취소</button>
          <button onclick="saveTodo()" class="bg-mint-500 hover:bg-mint-600 text-white px-6 py-2 rounded-lg font-medium transition">저장</button>
        </div>
        <input type="hidden" id="editTodoId" value="">
      </div>
    </div>
  </div>

  <!-- Admin Login Modal -->
  <div id="adminLoginModal" class="fixed inset-0 z-50 hidden">
    <div class="modal-overlay absolute inset-0" onclick="closeAdminLogin()"></div>
    <div class="relative flex items-center justify-center min-h-screen p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 relative z-10 fade-in dark:bg-slate-800">
        <h3 class="text-lg font-bold text-gray-800 mb-4 dark:text-white">
          <i class="fas fa-shield-alt text-yellow-500 mr-2"></i>관리자 인증
        </h3>
        <input id="adminPassword" type="password" placeholder="관리자 비밀번호" 
          class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-yellow-400 outline-none dark:bg-slate-700 dark:border-slate-600 dark:text-white"
          onkeydown="if(event.key==='Enter')verifyAdmin()">
        <p id="adminError" class="text-red-500 text-sm mt-2 hidden"></p>
        <div class="flex justify-end space-x-3 mt-4">
          <button onclick="closeAdminLogin()" class="px-4 py-2 text-gray-600 dark:text-gray-300">취소</button>
          <button onclick="verifyAdmin()" class="bg-yellow-500 hover:bg-yellow-600 text-white px-6 py-2 rounded-lg font-medium transition">확인</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Admin Panel Modal -->
  <div id="adminPanelModal" class="fixed inset-0 z-50 hidden">
    <div class="modal-overlay absolute inset-0" onclick="closeAdminPanel()"></div>
    <div class="relative flex items-center justify-center min-h-screen p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 relative z-10 fade-in dark:bg-slate-800">
        <h3 class="text-lg font-bold text-gray-800 mb-6 dark:text-white">
          <i class="fas fa-users-cog text-yellow-500 mr-2"></i>관리자 패널
        </h3>
        
        <div class="grid md:grid-cols-2 gap-6">
          <!-- Teachers Management -->
          <div>
            <h4 class="font-semibold text-gray-700 mb-3 dark:text-gray-200"><i class="fas fa-users mr-2 text-mint-500"></i>부서원 관리</h4>
            <div class="flex gap-2 mb-3">
              <input id="newTeacherName" type="text" placeholder="선생님 이름" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-white">
              <button onclick="addTeacher()" class="bg-mint-500 text-white px-3 py-2 rounded-lg text-sm hover:bg-mint-600 transition"><i class="fas fa-plus"></i></button>
            </div>
            <div id="teacherList" class="space-y-2 max-h-48 overflow-y-auto"></div>
          </div>
          
          <!-- Categories Management -->
          <div>
            <h4 class="font-semibold text-gray-700 mb-3 dark:text-gray-200"><i class="fas fa-tags mr-2 text-mint-500"></i>업무 구분 관리</h4>
            <div class="flex gap-2 mb-3">
              <input id="newCategoryName" type="text" placeholder="구분 이름" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-white">
              <input id="newCategoryColor" type="color" value="#5EEAD4" class="w-10 h-10 rounded-lg cursor-pointer border-0">
              <button onclick="addCategory()" class="bg-mint-500 text-white px-3 py-2 rounded-lg text-sm hover:bg-mint-600 transition"><i class="fas fa-plus"></i></button>
            </div>
            <div id="categoryList" class="space-y-2 max-h-48 overflow-y-auto"></div>
          </div>
        </div>
        
        <div class="flex justify-end mt-6">
          <button onclick="closeAdminPanel()" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition">닫기</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Comment Modal -->
  <div id="commentModal" class="fixed inset-0 z-50 hidden">
    <div class="modal-overlay absolute inset-0" onclick="closeCommentModal()"></div>
    <div class="relative flex items-center justify-center min-h-screen p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-6 relative z-10 fade-in dark:bg-slate-800">
        <h3 class="text-lg font-bold text-gray-800 mb-4 dark:text-white">
          <i class="fas fa-comments text-mint-500 mr-2"></i>관리자 코멘트
        </h3>
        <div id="commentList" class="space-y-3 mb-4 max-h-60 overflow-y-auto"></div>
        <div id="commentInputArea" class="hidden">
          <div class="flex gap-2">
            <input id="commentInput" type="text" placeholder="코멘트 입력..." 
              class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-white"
              onkeydown="if(event.key==='Enter')addComment()">
            <button onclick="addComment()" class="bg-mint-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-mint-600 transition">
              <i class="fas fa-paper-plane"></i>
            </button>
          </div>
        </div>
        <div class="flex justify-end mt-4">
          <button onclick="closeCommentModal()" class="text-gray-500 hover:text-gray-700 font-medium dark:text-gray-300">닫기</button>
        </div>
        <input type="hidden" id="commentTodoId" value="">
      </div>
    </div>
  </div>

  <script>
    // ===== State =====
    let currentRole = null;
    let currentPeriod = 'all';
    let darkMode = false;
    let todosData = [];
    let teachersData = [];
    let categoriesData = [];

    // ===== Auth =====
    function handleLogin() {
      const pw = document.getElementById('loginPassword').value;
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          currentRole = data.role;
          localStorage.setItem('tdl_role', currentRole);
          showMainApp();
        } else {
          const err = document.getElementById('loginError');
          err.textContent = data.message;
          err.classList.remove('hidden');
        }
      });
    }

    function handleLogout() {
      currentRole = null;
      localStorage.removeItem('tdl_role');
      document.getElementById('mainApp').classList.add('hidden');
      document.getElementById('loginScreen').classList.remove('hidden');
      document.getElementById('loginPassword').value = '';
    }

    function showAdminLogin() {
      if (currentRole === 'admin') {
        currentRole = 'user';
        localStorage.setItem('tdl_role', 'user');
        updateAdminUI();
        loadTodos();
        loadStats();
        return;
      }
      document.getElementById('adminLoginModal').classList.remove('hidden');
      document.getElementById('adminPassword').value = '';
      document.getElementById('adminError').classList.add('hidden');
      setTimeout(() => document.getElementById('adminPassword').focus(), 100);
    }

    function closeAdminLogin() {
      document.getElementById('adminLoginModal').classList.add('hidden');
    }

    function verifyAdmin() {
      const pw = document.getElementById('adminPassword').value;
      fetch('/api/auth/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          currentRole = 'admin';
          localStorage.setItem('tdl_role', 'admin');
          closeAdminLogin();
          updateAdminUI();
          loadTodos();
          loadStats();
        } else {
          const err = document.getElementById('adminError');
          err.textContent = data.message;
          err.classList.remove('hidden');
        }
      });
    }

    // ===== Init =====
    function showMainApp() {
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('mainApp').classList.remove('hidden');
      updateAdminUI();
      initData();
    }

    async function initData() {
      // Seed data on first load
      await fetch('/api/seed', { method: 'POST' });
      await loadTeachers();
      await loadCategories();
      await loadTodos();
      await loadStats();
    }

    function updateAdminUI() {
      const isAdmin = currentRole === 'admin';
      document.getElementById('adminBadge').classList.toggle('hidden', !isAdmin);
      document.getElementById('adminMgmtBtn').classList.toggle('hidden', !isAdmin);
      
      const cogIcon = document.getElementById('adminToggleBtn').querySelector('i');
      if (isAdmin) {
        cogIcon.className = 'fas fa-user text-yellow-300';
      } else {
        cogIcon.className = 'fas fa-cog';
      }
    }

    // ===== Dark Mode =====
    function toggleDarkMode() {
      darkMode = !darkMode;
      document.documentElement.classList.toggle('dark', darkMode);
      document.body.classList.toggle('bg-gray-50', !darkMode);
      document.body.classList.toggle('bg-slate-900', darkMode);
      const icon = document.getElementById('darkModeIcon');
      icon.className = darkMode ? 'fas fa-sun' : 'fas fa-moon';
    }

    // ===== Mobile Search =====
    function toggleMobileSearch() {
      document.getElementById('mobileSearch').classList.toggle('hidden');
    }

    function handleSearch() {
      loadTodos();
    }

    function handleMobileSearch() {
      document.getElementById('searchInput').value = document.getElementById('mobileSearchInput').value;
      loadTodos();
    }

    // ===== Period Filter =====
    function setPeriod(p) {
      currentPeriod = p;
      ['All','Day','Week','Month'].forEach(k => {
        const btn = document.getElementById('period' + k);
        if (k.toLowerCase() === p) {
          btn.className = 'px-3 py-1.5 rounded-md text-sm font-medium transition-all bg-mint-500 text-white';
        } else {
          btn.className = 'px-3 py-1.5 rounded-md text-sm font-medium transition-all text-gray-600 hover:text-gray-800 dark:text-gray-300';
        }
      });
      loadTodos();
    }

    // ===== Data Loading =====
    async function loadTeachers() {
      const res = await fetch('/api/teachers');
      teachersData = await res.json();
      
      // Update filter dropdown
      const filterSelect = document.getElementById('filterTeacher');
      filterSelect.innerHTML = '<option value="">모든 담당자</option>';
      teachersData.forEach(t => {
        filterSelect.innerHTML += '<option value="'+t.id+'">'+t.name+'</option>';
      });

      // Update modal dropdown
      const todoSelect = document.getElementById('todoTeacher');
      todoSelect.innerHTML = '<option value="">선택</option>';
      teachersData.forEach(t => {
        todoSelect.innerHTML += '<option value="'+t.id+'">'+t.name+'</option>';
      });
    }

    async function loadCategories() {
      const res = await fetch('/api/categories');
      categoriesData = await res.json();
      
      const filterSelect = document.getElementById('filterCategory');
      filterSelect.innerHTML = '<option value="">모든 업무구분</option>';
      categoriesData.forEach(c => {
        filterSelect.innerHTML += '<option value="'+c.id+'">'+c.name+'</option>';
      });

      const todoSelect = document.getElementById('todoCategory');
      todoSelect.innerHTML = '<option value="">선택 안함</option>';
      categoriesData.forEach(c => {
        todoSelect.innerHTML += '<option value="'+c.id+'">'+c.name+'</option>';
      });
    }

    async function loadTodos() {
      const isAdmin = currentRole === 'admin';
      const search = document.getElementById('searchInput').value;
      const teacherId = document.getElementById('filterTeacher').value;
      const categoryId = document.getElementById('filterCategory').value;
      
      const params = new URLSearchParams({
        admin: isAdmin.toString(),
        period: currentPeriod,
        search: search,
        teacher_id: teacherId,
        category_id: categoryId
      });

      const res = await fetch('/api/todos?' + params);
      todosData = await res.json();
      renderTodos();
    }

    async function loadStats() {
      const isAdmin = currentRole === 'admin';
      const res = await fetch('/api/stats?admin=' + isAdmin);
      const stats = await res.json();
      
      document.getElementById('statTotal').textContent = stats.total;
      document.getElementById('statInProgress').textContent = stats.inProgress;
      document.getElementById('statWaiting').textContent = stats.waitingApproval;
      document.getElementById('statAvgProgress').textContent = stats.avgProgress + '%';
    }

    // ===== Render Todos =====
    function getProgressLabel(progress) {
      if (progress === 0) return '미시작';
      if (progress <= 25) return '1단계: 시작';
      if (progress <= 50) return '2단계: 중간';
      if (progress <= 75) return '3단계: 발전';
      if (progress < 100) return '4단계: 마무리';
      return '완료 대기';
    }

    function getProgressColor(progress) {
      if (progress <= 25) return 'from-red-300 to-red-400';
      if (progress <= 50) return 'from-yellow-300 to-yellow-400';
      if (progress <= 75) return 'from-blue-300 to-blue-400';
      return 'from-mint-300 to-mint-500';
    }

    function getStatusBadge(todo) {
      if (todo.is_approved) return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><i class="fas fa-check-circle mr-1"></i>완료</span>';
      if (todo.progress === 100) return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"><i class="fas fa-clock mr-1"></i>승인대기</span>';
      if (todo.progress > 0) return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"><i class="fas fa-spinner mr-1"></i>진행중</span>';
      return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"><i class="fas fa-minus mr-1"></i>미시작</span>';
    }

    function getDueDateClass(dueDate) {
      if (!dueDate) return '';
      const today = new Date();
      today.setHours(0,0,0,0);
      const due = new Date(dueDate);
      const diff = Math.ceil((due - today) / (1000*60*60*24));
      if (diff < 0) return 'text-red-600 font-semibold';
      if (diff <= 2) return 'text-orange-500 font-medium';
      return 'text-gray-600 dark:text-gray-400';
    }

    function renderTodos() {
      const container = document.getElementById('todoList');
      const isAdmin = currentRole === 'admin';

      if (todosData.length === 0) {
        container.innerHTML = '<div class="p-12 text-center text-gray-400"><i class="fas fa-inbox text-4xl mb-3"></i><p class="text-lg">할 일이 없습니다</p><p class="text-sm mt-1">새로운 할 일을 추가해 주세요</p></div>';
        return;
      }

      let html = '';
      todosData.forEach(todo => {
        const catColor = todo.category_color || '#5EEAD4';
        const isPrivate = todo.is_private;
        const commentBadge = todo.comment_count > 0 ? '<span class="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-mint-100 text-mint-700 text-xs font-bold">' + todo.comment_count + '</span>' : '';
        
        // Desktop Row
        html += '<div class="hidden md:grid grid-cols-12 gap-2 px-6 py-4 hover:bg-gray-50 dark:hover:bg-slate-750 transition items-center group ' + (isPrivate ? 'opacity-60 bg-gray-50 dark:bg-slate-900' : '') + ' fade-in">';
        
        // Category
        html += '<div class="col-span-1"><span class="inline-block px-2 py-1 rounded-md text-xs font-medium text-white" style="background-color:'+catColor+'">'+(todo.category_name||'미분류')+'</span></div>';
        
        // Title
        html += '<div class="col-span-3">';
        if (isPrivate && isAdmin) html += '<i class="fas fa-lock text-yellow-500 mr-1 text-xs"></i>';
        html += '<span class="text-sm font-medium text-gray-800 dark:text-white cursor-pointer hover:text-mint-600 inline-edit" data-id="'+todo.id+'" data-field="title" onclick="startInlineEdit(this, '+todo.id+', &quot;title&quot;)">'+todo.title+'</span>';
        html += '</div>';
        
        // Teacher
        html += '<div class="col-span-1"><span class="text-sm text-gray-600 dark:text-gray-300">'+(todo.teacher_name||'-')+'</span></div>';
        
        // Due Date
        html += '<div class="col-span-1"><span class="text-xs '+getDueDateClass(todo.due_date)+'">'+(todo.due_date || '-')+'</span></div>';
        
        // Progress Slider
        html += '<div class="col-span-3 flex items-center gap-2">';
        html += '<input type="range" min="0" max="100" value="'+todo.progress+'" class="flex-1 slider-bg" '+(todo.is_approved ? 'disabled' : '')+' onchange="updateProgress('+todo.id+', this.value)" oninput="this.nextElementSibling.textContent=this.value+\'%\'">';
        html += '<span class="text-xs font-semibold text-gray-600 dark:text-gray-300 w-10 text-right">'+todo.progress+'%</span>';
        html += '</div>';
        
        // Status
        html += '<div class="col-span-1">'+getStatusBadge(todo)+'</div>';
        
        // Actions
        html += '<div class="col-span-2 flex items-center justify-end gap-1">';
        // Comment button
        html += '<button onclick="showComments('+todo.id+')" class="p-1.5 text-gray-400 hover:text-mint-600 transition relative" title="코멘트"><i class="fas fa-comment-dots"></i>'+commentBadge+'</button>';
        
        if (isAdmin) {
          // Private toggle
          html += '<button onclick="togglePrivate('+todo.id+', '+(!isPrivate)+' )" class="p-1.5 '+(isPrivate ? 'text-yellow-500' : 'text-gray-400')+' hover:text-yellow-600 transition" title="비공개 전환"><i class="fas '+(isPrivate ? 'fa-lock' : 'fa-lock-open')+'"></i></button>';
          // Approve button
          if (todo.progress === 100 && !todo.is_approved) {
            html += '<button onclick="approveTodo('+todo.id+')" class="p-1.5 text-green-500 hover:text-green-700 transition animate-pulse" title="최종 승인"><i class="fas fa-check-double"></i></button>';
          }
        }
        // Edit
        html += '<button onclick="editTodo('+todo.id+')" class="p-1.5 text-gray-400 hover:text-blue-600 transition" title="수정"><i class="fas fa-pen"></i></button>';
        // Delete
        html += '<button onclick="deleteTodo('+todo.id+')" class="p-1.5 text-gray-400 hover:text-red-600 transition" title="삭제"><i class="fas fa-trash"></i></button>';
        html += '</div>';
        html += '</div>';

        // Mobile Card
        html += '<div class="md:hidden p-4 border-b border-gray-100 dark:border-slate-700 ' + (isPrivate ? 'opacity-60 bg-gray-50 dark:bg-slate-900' : '') + ' fade-in">';
        html += '<div class="flex items-center justify-between mb-2">';
        html += '<div class="flex items-center gap-2">';
        html += '<span class="inline-block px-2 py-0.5 rounded-md text-xs font-medium text-white" style="background-color:'+catColor+'">'+(todo.category_name||'미분류')+'</span>';
        if (isPrivate && isAdmin) html += '<i class="fas fa-lock text-yellow-500 text-xs"></i>';
        html += '</div>';
        html += '<div class="flex items-center gap-1">';
        html += '<button onclick="showComments('+todo.id+')" class="p-1 text-gray-400 hover:text-mint-600 text-sm relative"><i class="fas fa-comment-dots"></i>'+commentBadge+'</button>';
        if (isAdmin) {
          html += '<button onclick="togglePrivate('+todo.id+', '+(!isPrivate)+')" class="p-1 '+(isPrivate ? 'text-yellow-500' : 'text-gray-400')+' text-sm"><i class="fas '+(isPrivate ? 'fa-lock' : 'fa-lock-open')+'"></i></button>';
          if (todo.progress === 100 && !todo.is_approved) {
            html += '<button onclick="approveTodo('+todo.id+')" class="p-1 text-green-500 text-sm animate-pulse"><i class="fas fa-check-double"></i></button>';
          }
        }
        html += '<button onclick="editTodo('+todo.id+')" class="p-1 text-gray-400 text-sm"><i class="fas fa-pen"></i></button>';
        html += '<button onclick="deleteTodo('+todo.id+')" class="p-1 text-gray-400 text-sm"><i class="fas fa-trash"></i></button>';
        html += '</div></div>';
        html += '<h4 class="font-medium text-gray-800 dark:text-white text-sm mb-1 cursor-pointer" onclick="startInlineEdit(this, '+todo.id+', &quot;title&quot;)">'+todo.title+'</h4>';
        html += '<div class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-2">';
        html += '<span><i class="fas fa-user mr-1"></i>'+(todo.teacher_name||'-')+'</span>';
        html += '<span class="'+getDueDateClass(todo.due_date)+'"><i class="fas fa-calendar mr-1"></i>'+(todo.due_date||'기한 없음')+'</span>';
        html += '</div>';
        html += '<div class="flex items-center gap-2 mb-2">';
        html += '<input type="range" min="0" max="100" value="'+todo.progress+'" class="flex-1 slider-bg" '+(todo.is_approved ? 'disabled' : '')+' onchange="updateProgress('+todo.id+', this.value)" oninput="this.nextElementSibling.textContent=this.value+\'%\'">';
        html += '<span class="text-xs font-semibold w-10 text-right">'+todo.progress+'%</span>';
        html += '</div>';
        html += '<div class="flex items-center justify-between">';
        html += '<span class="text-xs text-gray-400">'+getProgressLabel(todo.progress)+'</span>';
        html += getStatusBadge(todo);
        html += '</div></div>';
      });

      container.innerHTML = html;
    }

    // ===== CRUD Operations =====
    function showAddTodoModal() {
      document.getElementById('todoModalTitle').innerHTML = '<i class="fas fa-plus-circle text-mint-500 mr-2"></i>새 할 일 추가';
      document.getElementById('todoTitle').value = '';
      document.getElementById('todoDesc').value = '';
      document.getElementById('todoTeacher').value = '';
      document.getElementById('todoCategory').value = '';
      document.getElementById('todoDueDate').value = '';
      document.getElementById('editTodoId').value = '';
      document.getElementById('todoModal').classList.remove('hidden');
    }

    function editTodo(id) {
      const todo = todosData.find(t => t.id === id);
      if (!todo) return;
      document.getElementById('todoModalTitle').innerHTML = '<i class="fas fa-edit text-blue-500 mr-2"></i>할 일 수정';
      document.getElementById('todoTitle').value = todo.title;
      document.getElementById('todoDesc').value = todo.description || '';
      document.getElementById('todoTeacher').value = todo.teacher_id;
      document.getElementById('todoCategory').value = todo.category_id || '';
      document.getElementById('todoDueDate').value = todo.due_date || '';
      document.getElementById('editTodoId').value = id;
      document.getElementById('todoModal').classList.remove('hidden');
    }

    function closeTodoModal() {
      document.getElementById('todoModal').classList.add('hidden');
    }

    async function saveTodo() {
      const id = document.getElementById('editTodoId').value;
      const title = document.getElementById('todoTitle').value.trim();
      const desc = document.getElementById('todoDesc').value.trim();
      const teacherId = document.getElementById('todoTeacher').value;
      const categoryId = document.getElementById('todoCategory').value;
      const dueDate = document.getElementById('todoDueDate').value;

      if (!title) { alert('업무명을 입력해 주세요.'); return; }
      if (!teacherId) { alert('담당자를 선택해 주세요.'); return; }

      const body = {
        title,
        description: desc,
        teacher_id: parseInt(teacherId),
        category_id: categoryId ? parseInt(categoryId) : null,
        due_date: dueDate || null
      };

      if (id) {
        await fetch('/api/todos/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      } else {
        await fetch('/api/todos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      }

      closeTodoModal();
      loadTodos();
      loadStats();
    }

    async function deleteTodo(id) {
      if (!confirm('이 항목을 삭제하시겠습니까?')) return;
      await fetch('/api/todos/' + id, { method: 'DELETE' });
      loadTodos();
      loadStats();
    }

    async function updateProgress(id, value) {
      await fetch('/api/todos/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress: parseInt(value) })
      });
      loadTodos();
      loadStats();
    }

    async function togglePrivate(id, isPrivate) {
      await fetch('/api/todos/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_private: isPrivate })
      });
      loadTodos();
    }

    async function approveTodo(id) {
      if (!confirm('이 업무를 최종 승인(마감)하시겠습니까?')) return;
      await fetch('/api/todos/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_approved: true })
      });
      loadTodos();
      loadStats();
    }

    // ===== Inline Editing =====
    function startInlineEdit(el, id, field) {
      const currentText = el.textContent;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentText;
      input.className = 'px-2 py-1 border border-mint-400 rounded text-sm w-full focus:ring-2 focus:ring-mint-400 outline-none dark:bg-slate-700 dark:text-white';
      
      input.onblur = () => saveInlineEdit(input, el, id, field, currentText);
      input.onkeydown = (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { el.textContent = currentText; input.replaceWith(el); }
      };
      
      el.replaceWith(input);
      input.focus();
      input.select();
    }

    async function saveInlineEdit(input, originalEl, id, field, originalText) {
      const newValue = input.value.trim();
      if (newValue && newValue !== originalText) {
        await fetch('/api/todos/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: newValue })
        });
        loadTodos();
      } else {
        originalEl.textContent = originalText;
        input.replaceWith(originalEl);
      }
    }

    // ===== Comments =====
    async function showComments(todoId) {
      document.getElementById('commentTodoId').value = todoId;
      document.getElementById('commentModal').classList.remove('hidden');
      document.getElementById('commentInputArea').classList.toggle('hidden', currentRole !== 'admin');
      
      const res = await fetch('/api/todos/' + todoId + '/comments');
      const comments = await res.json();
      
      const container = document.getElementById('commentList');
      if (comments.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-400 py-4"><i class="fas fa-comment-slash text-2xl mb-2"></i><p class="text-sm">코멘트가 없습니다</p></div>';
      } else {
        container.innerHTML = comments.map(c => 
          '<div class="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 relative">' +
          '<div class="flex items-start gap-2">' +
          '<i class="fas fa-comment text-mint-500 mt-1"></i>' +
          '<div class="flex-1">' +
          '<p class="text-sm text-gray-700 dark:text-gray-200">' + c.content + '</p>' +
          '<p class="text-xs text-gray-400 mt-1">' + new Date(c.created_at).toLocaleString('ko-KR') + '</p>' +
          '</div>' +
          (currentRole === 'admin' ? '<button onclick="deleteComment('+c.id+', '+todoId+')" class="text-gray-300 hover:text-red-500 text-xs"><i class="fas fa-times"></i></button>' : '') +
          '</div></div>'
        ).join('');
      }
    }

    function closeCommentModal() {
      document.getElementById('commentModal').classList.add('hidden');
    }

    async function addComment() {
      const todoId = document.getElementById('commentTodoId').value;
      const content = document.getElementById('commentInput').value.trim();
      if (!content) return;
      
      await fetch('/api/todos/' + todoId + '/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      
      document.getElementById('commentInput').value = '';
      showComments(todoId);
      loadTodos();
    }

    async function deleteComment(commentId, todoId) {
      await fetch('/api/comments/' + commentId, { method: 'DELETE' });
      showComments(todoId);
      loadTodos();
    }

    // ===== Admin Panel =====
    function showAdminPanel() {
      document.getElementById('adminPanelModal').classList.remove('hidden');
      renderAdminTeachers();
      renderAdminCategories();
    }

    function closeAdminPanel() {
      document.getElementById('adminPanelModal').classList.add('hidden');
    }

    function renderAdminTeachers() {
      const container = document.getElementById('teacherList');
      container.innerHTML = teachersData.map(t =>
        '<div class="flex items-center justify-between bg-gray-50 dark:bg-slate-700 px-3 py-2 rounded-lg">' +
        '<span class="text-sm text-gray-700 dark:text-gray-200"><i class="fas fa-user text-mint-500 mr-2"></i>' + t.name + '</span>' +
        '<button onclick="deleteTeacher('+t.id+')" class="text-red-400 hover:text-red-600 text-sm"><i class="fas fa-trash"></i></button>' +
        '</div>'
      ).join('');
    }

    function renderAdminCategories() {
      const container = document.getElementById('categoryList');
      container.innerHTML = categoriesData.map(c =>
        '<div class="flex items-center justify-between bg-gray-50 dark:bg-slate-700 px-3 py-2 rounded-lg">' +
        '<div class="flex items-center gap-2">' +
        '<div class="w-4 h-4 rounded" style="background-color:'+c.color+'"></div>' +
        '<span class="text-sm text-gray-700 dark:text-gray-200">' + c.name + '</span>' +
        '</div>' +
        '<button onclick="deleteCategory('+c.id+')" class="text-red-400 hover:text-red-600 text-sm"><i class="fas fa-trash"></i></button>' +
        '</div>'
      ).join('');
    }

    async function addTeacher() {
      const name = document.getElementById('newTeacherName').value.trim();
      if (!name) return;
      await fetch('/api/teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      document.getElementById('newTeacherName').value = '';
      await loadTeachers();
      renderAdminTeachers();
    }

    async function deleteTeacher(id) {
      if (!confirm('이 선생님을 삭제하시겠습니까?')) return;
      await fetch('/api/teachers/' + id, { method: 'DELETE' });
      await loadTeachers();
      renderAdminTeachers();
    }

    async function addCategory() {
      const name = document.getElementById('newCategoryName').value.trim();
      const color = document.getElementById('newCategoryColor').value;
      if (!name) return;
      await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color })
      });
      document.getElementById('newCategoryName').value = '';
      await loadCategories();
      renderAdminCategories();
    }

    async function deleteCategory(id) {
      if (!confirm('이 카테고리를 삭제하시겠습니까?')) return;
      await fetch('/api/categories/' + id, { method: 'DELETE' });
      await loadCategories();
      renderAdminCategories();
    }

    // ===== Excel Export =====
    function exportExcel() {
      const data = todosData.map(t => ({
        '업무구분': t.category_name || '미분류',
        '업무명': t.title,
        '상세설명': t.description || '',
        '담당자': t.teacher_name || '-',
        '마감기한': t.due_date || '-',
        '진행률(%)': t.progress,
        '진행단계': getProgressLabel(t.progress),
        '승인여부': t.is_approved ? '완료' : (t.progress === 100 ? '승인대기' : '미완료'),
        '비공개': t.is_private ? 'Y' : 'N',
        '코멘트수': t.comment_count || 0
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'To-Do List');
      
      // Column widths
      ws['!cols'] = [
        {wch:10}, {wch:30}, {wch:40}, {wch:10}, {wch:12}, {wch:10}, {wch:15}, {wch:10}, {wch:8}, {wch:10}
      ];

      const now = new Date().toISOString().slice(0,10);
      XLSX.writeFile(wb, 'TDL_업무목록_' + now + '.xlsx');
    }

    // ===== Auto Login Check =====
    window.addEventListener('DOMContentLoaded', () => {
      const savedRole = localStorage.getItem('tdl_role');
      if (savedRole) {
        currentRole = savedRole;
        showMainApp();
      }
    });
  </script>
</body>
</html>`
}

export default app
