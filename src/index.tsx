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
      status TEXT DEFAULT 'working',
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
      author_type TEXT DEFAULT 'admin',
      author_name TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS frequent_phrases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phrase TEXT NOT NULL UNIQUE,
      use_count INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`)
  ])
}

// ===== Auth API =====
app.post('/api/auth/login', async (c) => {
  const { password } = await c.req.json()
  if (password === '13579') {
    return c.json({ success: true, role: 'user' })
  }
  if (password === '1026') {
    return c.json({ success: true, role: 'admin' })
  }
  return c.json({ success: false, message: '\ube44\ubc00\ubc88\ud638\uac00 \uc62c\ubc14\ub974\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.' }, 401)
})

app.post('/api/auth/admin', async (c) => {
  const { password } = await c.req.json()
  if (password === '1026') {
    return c.json({ success: true, role: 'admin' })
  }
  return c.json({ success: false, message: '\uad00\ub9ac\uc790 \ube44\ubc00\ubc88\ud638\uac00 \uc62c\ubc14\ub974\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.' }, 401)
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

// ===== Settings API =====
app.get('/api/settings/:key', async (c) => {
  await ensureDB(c.env.DB)
  const key = c.req.param('key')
  const row = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first()
  return c.json({ value: row?.value || '' })
})

app.put('/api/settings/:key', async (c) => {
  await ensureDB(c.env.DB)
  const key = c.req.param('key')
  const { value } = await c.req.json()
  await c.env.DB.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))').bind(key, value).run()
  return c.json({ success: true })
})

// ===== Frequent Phrases API =====
app.get('/api/phrases', async (c) => {
  await ensureDB(c.env.DB)
  const { results } = await c.env.DB.prepare('SELECT * FROM frequent_phrases ORDER BY use_count DESC, created_at DESC LIMIT 20').all()
  return c.json(results)
})

app.post('/api/phrases', async (c) => {
  await ensureDB(c.env.DB)
  const { phrase } = await c.req.json()
  const existing = await c.env.DB.prepare('SELECT id FROM frequent_phrases WHERE phrase = ?').bind(phrase).first()
  if (existing) {
    await c.env.DB.prepare('UPDATE frequent_phrases SET use_count = use_count + 1 WHERE phrase = ?').bind(phrase).run()
  } else {
    await c.env.DB.prepare('INSERT INTO frequent_phrases (phrase) VALUES (?)').bind(phrase).run()
  }
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
  const statusFilter = c.req.query('status') || ''

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

  if (statusFilter) {
    if (statusFilter === 'completed') {
      query += " AND t.status = 'completed'"
    } else if (statusFilter === 'working') {
      query += " AND t.status = 'working'"
    } else if (statusFilter === 'reported') {
      query += " AND t.status = 'reported'"
    } else if (statusFilter === 'hold') {
      query += " AND t.status = 'hold'"
    }
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
    'INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    body.title,
    body.description || '',
    body.teacher_id,
    body.category_id || null,
    body.progress || 0,
    body.due_date || null,
    body.status || 'working'
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
  if (body.status !== undefined) { sets.push('status = ?'); vals.push(body.status) }
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
    'SELECT * FROM comments WHERE todo_id = ? ORDER BY created_at ASC'
  ).bind(todoId).all()
  return c.json(results)
})

app.post('/api/todos/:id/comments', async (c) => {
  const todoId = c.req.param('id')
  const { content, author_type, author_name } = await c.req.json()
  const result = await c.env.DB.prepare(
    'INSERT INTO comments (todo_id, content, author_type, author_name) VALUES (?, ?, ?, ?)'
  ).bind(todoId, content, author_type || 'admin', author_name || '').run()

  if (content && content.length >= 5) {
    try {
      const existing = await c.env.DB.prepare('SELECT id FROM frequent_phrases WHERE phrase = ?').bind(content).first()
      if (existing) {
        await c.env.DB.prepare('UPDATE frequent_phrases SET use_count = use_count + 1 WHERE phrase = ?').bind(content).run()
      } else {
        await c.env.DB.prepare('INSERT INTO frequent_phrases (phrase) VALUES (?)').bind(content).run()
      }
    } catch(e) {}
  }

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
  const inProgress = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM todos ${whereClause ? whereClause + ' AND' : 'WHERE'} status = 'working'`).first()
  const waitingApproval = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM todos ${whereClause ? whereClause + ' AND' : 'WHERE'} status = 'reported'`).first()

  const motto = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_motto'").first()

  return c.json({
    total: total?.count || 0,
    inProgress: inProgress?.count || 0,
    waitingApproval: waitingApproval?.count || 0,
    motto: motto?.value || ''
  })
})

// ===== Seed data endpoint =====
app.post('/api/seed', async (c) => {
  await ensureDB(c.env.DB)
  
  const existing = await c.env.DB.prepare('SELECT COUNT(*) as count FROM teachers').first()
  if (existing && Number(existing.count) > 0) {
    return c.json({ message: 'Data already seeded' })
  }

  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO teachers (name) VALUES ('\uae40\ubbfc\uc218')"),
    c.env.DB.prepare("INSERT INTO teachers (name) VALUES ('\uc774\uc601\ud76c')"),
    c.env.DB.prepare("INSERT INTO teachers (name) VALUES ('\ubc15\uc9c0\ud6c8')"),
    c.env.DB.prepare("INSERT INTO teachers (name) VALUES ('\ucd5c\uc218\uc5f0')"),
    c.env.DB.prepare("INSERT INTO teachers (name) VALUES ('\uc815\ub300\ud638')"),
  ])

  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO categories (name, color) VALUES ('\uae30\ud68d', '#5EEAD4')"),
    c.env.DB.prepare("INSERT INTO categories (name, color) VALUES ('\ucc3d\uccb4', '#FCA5A5')"),
    c.env.DB.prepare("INSERT INTO categories (name, color) VALUES ('\uad50\uc721\uacfc\uc815', '#93C5FD')"),
    c.env.DB.prepare("INSERT INTO categories (name, color) VALUES ('\ud589\uc815', '#FDE68A')"),
    c.env.DB.prepare("INSERT INTO categories (name, color) VALUES ('\uc5f0\uc218', '#C4B5FD')"),
  ])

  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date, status) VALUES ('2026 \uad50\uc721\uacfc\uc815 \ud3b8\uc131\uc548 \uc791\uc131', '\ud559\ub144\ubcc4 \uad50\uc721\uacfc\uc815 \ud3b8\uc131\uc548\uc744 \uc791\uc131\ud558\uace0 \uac80\ud1a0\ud569\ub2c8\ub2e4.', 1, 3, 75, '2026-04-15', 'working')"),
    c.env.DB.prepare("INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date, status) VALUES ('\ucc3d\uc758\uc801 \uccb4\ud5d8\ud65c\ub3d9 \uacc4\ud68d\uc11c', '1\ud559\uae30 \ucc3d\uccb4 \ud65c\ub3d9 \uc138\ubd80 \uacc4\ud68d\uc744 \uc218\ub9bd\ud569\ub2c8\ub2e4.', 2, 2, 40, '2026-04-10', 'working')"),
    c.env.DB.prepare("INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date, status) VALUES ('\ud559\ubd80\ubaa8 \ucd1d\ud68c \uc900\ube44', '\ud559\ubd80\ubaa8 \ucd1d\ud68c \uc790\ub8cc \ubc0f \ubc1c\ud45c \uc900\ube44\ub97c \ud569\ub2c8\ub2e4.', 3, 1, 100, '2026-03-28', 'reported')"),
    c.env.DB.prepare("INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date, status) VALUES ('\uad50\uc6d0 \uc5f0\uc218 \uc77c\uc815 \uc218\ub9bd', '\uc0c1\ubc18\uae30 \uad50\uc6d0 \uc5f0\uc218 \uc77c\uc815\uc744 \ud655\uc815\ud569\ub2c8\ub2e4.', 4, 5, 20, '2026-04-05', 'working')"),
    c.env.DB.prepare("INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date, status) VALUES ('\uc608\uc0b0 \uc9d1\ud589 \ud604\ud669 \uc815\ub9ac', '1\ubd84\uae30 \uc608\uc0b0 \uc9d1\ud589 \ud604\ud669\uc744 \uc815\ub9ac\ud569\ub2c8\ub2e4.', 5, 4, 60, '2026-04-20', 'working')"),
    c.env.DB.prepare("INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date, status) VALUES ('\ud559\uad50 \ud648\ud398\uc774\uc9c0 \uc5c5\ub370\uc774\ud2b8', '\ucd5c\uc2e0 \uacf5\uc9c0\uc0ac\ud56d \ubc0f \uac24\ub7ec\ub9ac\ub97c \uc5c5\ub370\uc774\ud2b8\ud569\ub2c8\ub2e4.', 1, 4, 30, '2026-03-30', 'hold')"),
    c.env.DB.prepare("INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date, status) VALUES ('\ubc29\uacfc\ud6c4\ud559\uad50 \ud504\ub85c\uadf8\ub7a8 \uae30\ud68d', '2\ud559\uae30 \ubc29\uacfc\ud6c4\ud559\uad50 \ud504\ub85c\uadf8\ub7a8\uc744 \uae30\ud68d\ud569\ub2c8\ub2e4.', 2, 1, 10, '2026-05-01', 'working')"),
    c.env.DB.prepare("INSERT INTO todos (title, description, teacher_id, category_id, progress, due_date, status) VALUES ('\uc548\uc804\uad50\uc721 \uc2e4\uc2dc \ubcf4\uace0\uc11c', '3\uc6d4 \uc548\uc804\uad50\uc721 \uc2e4\uc2dc \uacb0\uacfc\ub97c \ubcf4\uace0\ud569\ub2c8\ub2e4.', 3, 3, 90, '2026-03-31', 'working')"),
  ])

  await c.env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_motto', '\ud568\uaed8 \uc131\uc7a5\ud558\ub294 \uc6b0\ub9ac \ubd80\uc11c, \uc624\ub298\ub3c4 \ud654\uc774\ud305!')").run()

  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO frequent_phrases (phrase, use_count) VALUES ('\ud655\uc778\ud588\uc2b5\ub2c8\ub2e4. \uc218\uace0\ud558\uc168\uc2b5\ub2c8\ub2e4.', 5)"),
    c.env.DB.prepare("INSERT OR IGNORE INTO frequent_phrases (phrase, use_count) VALUES ('\uc9c4\ud589 \uc0c1\ud669 \uacf5\uc720 \ubd80\ud0c1\ub4dc\ub9bd\ub2c8\ub2e4.', 3)"),
    c.env.DB.prepare("INSERT OR IGNORE INTO frequent_phrases (phrase, use_count) VALUES ('\uae30\ud55c \ub0b4 \uc644\ub8cc \ubd80\ud0c1\ub4dc\ub9bd\ub2c8\ub2e4.', 3)"),
    c.env.DB.prepare("INSERT OR IGNORE INTO frequent_phrases (phrase, use_count) VALUES ('\uac80\ud1a0 \uc644\ub8cc\ud588\uc2b5\ub2c8\ub2e4. \uc9c4\ud589\ud574 \uc8fc\uc138\uc694.', 2)"),
    c.env.DB.prepare("INSERT OR IGNORE INTO frequent_phrases (phrase, use_count) VALUES ('\uc218\uc815 \uc0ac\ud56d\uc774 \uc788\uc2b5\ub2c8\ub2e4. \ud655\uc778\ud574 \uc8fc\uc138\uc694.', 2)"),
  ])

  return c.json({ message: 'Seed data inserted successfully' })
})

// ===== Serve SPA =====
app.get('/', async (c) => {
  return c.html(getIndexHTML())
})

app.get('*', async (c) => {
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
  <script src="https://cdn.tailwindcss.com"><\/script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"><\/script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            mint: { 50:'#f0fdfa', 100:'#ccfbf1', 200:'#99f6e4', 300:'#5eead4', 400:'#2dd4bf', 500:'#14b8a6', 600:'#0d9488', 700:'#0f766e', 800:'#115e59', 900:'#134e4a' },
            peach: { 50:'#fff7ed', 100:'#ffedd5', 200:'#fed7aa', 300:'#fdba74' },
          }
        }
      }
    }
  <\/script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&display=swap');
    * { font-family: 'Noto Sans KR', sans-serif; }
    input[type="range"] { -webkit-appearance: none; appearance: none; height: 6px; border-radius: 4px; outline: none; }
    input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #14b8a6; cursor: pointer; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2); transition: transform 0.15s ease; }
    input[type="range"]::-webkit-slider-thumb:hover { transform: scale(1.2); }
    input[type="range"]::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: #14b8a6; cursor: pointer; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
    .fade-in { animation: fadeIn 0.5s cubic-bezier(0.23,1,0.32,1); }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
    .slide-up { animation: slideUp 0.5s cubic-bezier(0.23,1,0.32,1) both; }
    @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    .scale-in { animation: scaleIn 0.3s cubic-bezier(0.23,1,0.32,1); }
    @keyframes scaleIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
    .modal-anim { animation: modalIn 0.35s cubic-bezier(0.23,1,0.32,1); }
    @keyframes modalIn { from { opacity: 0; transform: scale(0.92) translateY(20px); } to { opacity: 1; transform: scale(1) translateY(0); } }
    @keyframes pulse-soft { 0%,100% { box-shadow: 0 0 0 0 rgba(20,184,166,0.3); } 50% { box-shadow: 0 0 0 8px rgba(20,184,166,0); } }
    .pulse-soft { animation: pulse-soft 2s ease-in-out infinite; }
    .card-hover { transition: all 0.3s cubic-bezier(0.23,1,0.32,1); cursor: pointer; }
    .card-hover:hover { transform: translateY(-4px); box-shadow: 0 12px 24px -8px rgba(0,0,0,0.15); }
    .card-hover:active { transform: translateY(-1px); }
    .card-active { ring: 2px; box-shadow: 0 0 0 3px rgba(20,184,166,0.4); }
    .slider-bg { background: linear-gradient(to right, #99f6e4 0%, #14b8a6 50%, #0d9488 100%); }
    .modal-overlay { background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); }
    .tooltip { position: relative; }
    .tooltip:hover::after { content: attr(data-tip); position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: #1e293b; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; white-space: nowrap; z-index: 50; }
    .phrase-dropdown { position: absolute; bottom: 100%; left: 0; right: 0; max-height: 160px; overflow-y: auto; z-index: 60; }
    .chat-bubble-admin { background: #ccfbf1; border-radius: 12px 12px 12px 2px; }
    .chat-bubble-user { background: #e0e7ff; border-radius: 12px 12px 2px 12px; }
    .dark .chat-bubble-admin { background: #134e4a; }
    .dark .chat-bubble-user { background: #312e81; }
    .todo-row { transition: all 0.25s ease; }
    .todo-row:hover { background: rgba(20,184,166,0.04) !important; }
    .stagger-1 { animation-delay: 0.05s; } .stagger-2 { animation-delay: 0.1s; } .stagger-3 { animation-delay: 0.15s; } .stagger-4 { animation-delay: 0.2s; }
    .card-detail-anim { animation: cardDetail 0.3s cubic-bezier(0.23,1,0.32,1); }
    @keyframes cardDetail { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    .progress-compact { max-width: 66%; min-width: 50px; }
    .count-anim { transition: all 0.3s ease; }
  </style>
</head>
<body class="bg-gray-50 min-h-screen transition-colors duration-300">

  <!-- Login Screen -->
  <div id="loginScreen" class="min-h-screen flex items-center justify-center bg-gradient-to-br from-mint-100 to-mint-200">
    <div class="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md mx-4 fade-in">
      <div class="text-center mb-8">
        <div class="w-20 h-20 bg-mint-500 rounded-2xl flex items-center justify-center mx-auto mb-4 pulse-soft">
          <i class="fas fa-clipboard-check text-white text-3xl"></i>
        </div>
        <h1 class="text-2xl font-bold text-gray-800">To-Do-List</h1>
        <p class="text-gray-500 mt-2 text-sm">\ubd80\uc11c \uc5c5\ubb34 \uad00\ub9ac \uc2dc\uc2a4\ud15c</p>
      </div>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-600 mb-2">\ube44\ubc00\ubc88\ud638\ub97c \uc785\ub825\ud558\uc138\uc694</label>
          <input id="loginPassword" type="password" placeholder="\ube44\ubc00\ubc88\ud638 \uc785\ub825" 
            class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-mint-400 focus:border-transparent outline-none transition"
            onkeydown="if(event.key==='Enter')handleLogin()">
        </div>
        <button onclick="handleLogin()" class="w-full bg-mint-500 hover:bg-mint-600 text-white font-semibold py-3 rounded-xl transition-all duration-200 shadow-lg shadow-mint-200">
          <i class="fas fa-sign-in-alt mr-2"></i>\ub85c\uadf8\uc778
        </button>
        <p id="loginError" class="text-red-500 text-sm text-center hidden"></p>
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
              <p class="text-mint-100 text-xs hidden sm:block">\ubd80\uc11c \uc5c5\ubb34 \uad00\ub9ac</p>
            </div>
          </div>
          
          <div class="flex items-center space-x-1 sm:space-x-2">
            <!-- Completed Filter Button -->
            <button id="completedFilterBtn" onclick="toggleCompletedFilter()" class="px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-xs sm:text-sm font-medium transition flex items-center gap-1" data-tip="\uc644\ub8cc \ud56d\ubaa9\ub9cc \ubcf4\uae30">
              <i class="fas fa-check-circle"></i>
              <span class="hidden sm:inline">\uc644\ub8cc</span>
            </button>
            <!-- Dark Mode -->
            <button onclick="toggleDarkMode()" class="p-2 hover:bg-white/20 rounded-lg transition tooltip" data-tip="\ub2e4\ud06c\ubaa8\ub4dc">
              <i id="darkModeIcon" class="fas fa-moon"></i>
            </button>
            <!-- Search -->
            <div class="relative hidden sm:block">
              <input id="searchInput" type="text" placeholder="\uac80\uc0c9..." 
                class="bg-white/20 text-white placeholder-white/60 px-4 py-2 rounded-lg text-sm w-40 focus:w-56 transition-all focus:bg-white/30 outline-none"
                oninput="handleSearch()">
              <i class="fas fa-search absolute right-3 top-2.5 text-white/60 text-sm"></i>
            </div>
            <!-- Mobile Search Toggle -->
            <button onclick="toggleMobileSearch()" class="sm:hidden p-2 hover:bg-white/20 rounded-lg transition">
              <i class="fas fa-search"></i>
            </button>
            <!-- Admin Badge -->
            <span id="adminBadge" class="hidden bg-yellow-400 text-yellow-900 px-2 py-1 rounded-full text-xs font-bold">
              <i class="fas fa-shield-alt mr-1"></i><span class="hidden sm:inline">\uad00\ub9ac\uc790</span>
            </span>
            <!-- Admin Toggle -->
            <button id="adminToggleBtn" onclick="showAdminLogin()" class="p-2 hover:bg-white/20 rounded-lg transition tooltip" data-tip="\uad00\ub9ac\uc790 \ubaa8\ub4dc">
              <i class="fas fa-cog"></i>
            </button>
            <!-- Logout -->
            <button onclick="handleLogout()" class="p-2 hover:bg-white/20 rounded-lg transition tooltip" data-tip="\ub85c\uadf8\uc544\uc6c3">
              <i class="fas fa-sign-out-alt"></i>
            </button>
          </div>
        </div>
        <!-- Mobile Search Bar -->
        <div id="mobileSearch" class="hidden mt-3 sm:hidden">
          <input id="mobileSearchInput" type="text" placeholder="\uc5c5\ubb34, \ub2f4\ub2f9\uc790, \uce74\ud14c\uace0\ub9ac \uac80\uc0c9..." 
            class="w-full bg-white/20 text-white placeholder-white/60 px-4 py-2 rounded-lg text-sm focus:bg-white/30 outline-none"
            oninput="handleMobileSearch()">
        </div>
      </div>
    </nav>

    <!-- Dashboard Content -->
    <div class="max-w-7xl mx-auto px-4 py-6">
      
      <!-- Summary Cards (3 cards + motto card) -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div onclick="openCardDetail('total')" id="card-total" class="bg-mint-50 border border-mint-100 rounded-2xl p-5 card-hover dark:bg-slate-800 dark:border-slate-700 slide-up stagger-1">
          <div class="flex items-center justify-between mb-3">
            <div class="w-10 h-10 bg-mint-200 rounded-xl flex items-center justify-center">
              <i class="fas fa-list-check text-mint-700"></i>
            </div>
            <span class="text-xs text-mint-600 font-medium bg-mint-100 px-2 py-1 rounded-full dark:bg-slate-700 dark:text-mint-400">\uc804\uccb4</span>
          </div>
          <p id="statTotal" class="text-3xl font-bold text-gray-800 dark:text-white count-anim">0</p>
          <p class="text-sm text-gray-500 dark:text-gray-400">\uc804\uccb4 \ud560 \uc77c</p>
        </div>
        <div onclick="openCardDetail('working')" id="card-working" class="bg-peach-50 border border-orange-100 rounded-2xl p-5 card-hover dark:bg-slate-800 dark:border-slate-700 slide-up stagger-2">
          <div class="flex items-center justify-between mb-3">
            <div class="w-10 h-10 bg-orange-200 rounded-xl flex items-center justify-center">
              <i class="fas fa-spinner text-orange-700"></i>
            </div>
            <span class="text-xs text-orange-600 font-medium bg-orange-100 px-2 py-1 rounded-full dark:bg-slate-700 dark:text-orange-400">\uc9c4\ud589</span>
          </div>
          <p id="statInProgress" class="text-3xl font-bold text-gray-800 dark:text-white count-anim">0</p>
          <p class="text-sm text-gray-500 dark:text-gray-400">\uc791\uc5c5 \uc911</p>
        </div>
        <div onclick="openCardDetail('reported')" id="card-reported" class="bg-purple-50 border border-purple-100 rounded-2xl p-5 card-hover dark:bg-slate-800 dark:border-slate-700 slide-up stagger-3">
          <div class="flex items-center justify-between mb-3">
            <div class="w-10 h-10 bg-purple-200 rounded-xl flex items-center justify-center">
              <i class="fas fa-flag-checkered text-purple-600"></i>
            </div>
            <span class="text-xs text-purple-600 font-medium bg-purple-100 px-2 py-1 rounded-full dark:bg-slate-700 dark:text-purple-400">\ubcf4\uace0</span>
          </div>
          <p id="statWaiting" class="text-3xl font-bold text-gray-800 dark:text-white count-anim">0</p>
          <p class="text-sm text-gray-500 dark:text-gray-400">\uad00\ubcf4\uace0(\uc644)</p>
        </div>
        <!-- Motto Card -->
        <div class="bg-blue-50 border border-blue-100 rounded-2xl p-5 card-hover dark:bg-slate-800 dark:border-slate-700 slide-up stagger-4">
          <div class="flex items-center justify-between mb-3">
            <div class="w-10 h-10 bg-blue-200 rounded-xl flex items-center justify-center">
              <i class="fas fa-quote-left text-blue-700"></i>
            </div>
            <span class="text-xs text-blue-600 font-medium bg-blue-100 px-2 py-1 rounded-full dark:bg-slate-700 dark:text-blue-400">Sharing a message</span>
          </div>
          <p id="statMotto" class="text-sm font-medium text-gray-700 dark:text-gray-200 leading-relaxed line-clamp-3" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;"></p>
        </div>
      </div>

      <!-- Card Detail Panel -->
      <div id="cardDetailPanel" class="hidden mb-6 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden dark:bg-slate-800 dark:border-slate-700 card-detail-anim">
        <div class="flex items-center justify-between px-5 py-3 bg-gray-50 dark:bg-slate-900 border-b border-gray-100 dark:border-slate-700">
          <h3 id="cardDetailTitle" class="text-sm font-bold text-gray-700 dark:text-gray-200"><i class="fas fa-list mr-2"></i>\uc0c1\uc138 \ubaa9\ub85d</h3>
          <button onclick="closeCardDetail()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition"><i class="fas fa-times"></i></button>
        </div>
        <div id="cardDetailList" class="divide-y divide-gray-50 dark:divide-slate-700 max-h-72 overflow-y-auto"></div>
      </div>

      <!-- Filter & Action Bar -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-6 dark:bg-slate-800 dark:border-slate-700 fade-in">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <!-- Period Filter -->
            <div class="flex bg-gray-100 rounded-lg p-1 dark:bg-slate-700">
              <button onclick="setPeriod('all')" id="periodAll" class="px-3 py-1.5 rounded-md text-sm font-medium transition-all bg-mint-500 text-white">\uc804\uccb4</button>
              <button onclick="setPeriod('day')" id="periodDay" class="px-3 py-1.5 rounded-md text-sm font-medium transition-all text-gray-600 hover:text-gray-800 dark:text-gray-300">\ub2f9\uc77c</button>
              <button onclick="setPeriod('week')" id="periodWeek" class="px-3 py-1.5 rounded-md text-sm font-medium transition-all text-gray-600 hover:text-gray-800 dark:text-gray-300">\uc8fc\ubcc4</button>
              <button onclick="setPeriod('month')" id="periodMonth" class="px-3 py-1.5 rounded-md text-sm font-medium transition-all text-gray-600 hover:text-gray-800 dark:text-gray-300">\uc6d4\ubcc4</button>
            </div>
            <!-- Teacher Filter -->
            <select id="filterTeacher" onchange="loadTodos()" class="px-3 py-2 border border-gray-200 rounded-lg text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-white">
              <option value="">\ubaa8\ub4e0 \ub2f4\ub2f9\uc790</option>
            </select>
            <!-- Category Filter -->
            <select id="filterCategory" onchange="loadTodos()" class="px-3 py-2 border border-gray-200 rounded-lg text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-white">
              <option value="">\ubaa8\ub4e0 \uc5c5\ubb34\uad6c\ubd84</option>
            </select>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="exportExcel()" class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
              <i class="fas fa-file-excel mr-1"></i>
              <span class="hidden sm:inline">\uc5d1\uc140</span>
            </button>
            <button id="addTodoBtn" onclick="showAddTodoModal()" class="bg-mint-500 hover:bg-mint-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
              <i class="fas fa-plus mr-1"></i>
              <span class="hidden sm:inline">\ud560 \uc77c \ucd94\uac00</span>
              <span class="sm:hidden">\ucd94\uac00</span>
            </button>
            <button id="adminMgmtBtn" onclick="showAdminPanel()" class="hidden bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
              <i class="fas fa-users-cog mr-1"></i>
              <span class="hidden sm:inline">\uad00\ub9ac</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Todo List -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden dark:bg-slate-800 dark:border-slate-700">
        <div class="hidden md:grid grid-cols-12 gap-2 px-6 py-3 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider dark:bg-slate-900 dark:border-slate-700 dark:text-gray-400">
          <div class="col-span-1">\uad6c\ubd84</div>
          <div class="col-span-3">\uc5c5\ubb34\uba85</div>
          <div class="col-span-1">\ub2f4\ub2f9\uc790</div>
          <div class="col-span-1">\uae30\ud55c</div>
          <div class="col-span-3">\uc9c4\ud589\ub960</div>
          <div class="col-span-1">\uc0c1\ud0dc</div>
          <div class="col-span-2 text-right">\uc791\uc5c5</div>
        </div>
        <div id="todoList" class="divide-y divide-gray-50 dark:divide-slate-700">
          <div class="p-8 text-center text-gray-400">
            <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
            <p>\ub85c\ub529 \uc911...</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Add/Edit Todo Modal -->
  <div id="todoModal" class="fixed inset-0 z-50 hidden">
    <div class="modal-overlay absolute inset-0" onclick="closeTodoModal()"></div>
    <div class="relative flex items-center justify-center min-h-screen p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 relative z-10 modal-anim dark:bg-slate-800">
        <h3 id="todoModalTitle" class="text-lg font-bold text-gray-800 mb-4 dark:text-white">
          <i class="fas fa-plus-circle text-mint-500 mr-2"></i>\uc0c8 \ud560 \uc77c \ucd94\uac00
        </h3>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1 dark:text-gray-300">\uc5c5\ubb34\uba85 *</label>
            <input id="todoTitle" type="text" class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-mint-400 outline-none dark:bg-slate-700 dark:border-slate-600 dark:text-white" placeholder="\uc5c5\ubb34\uba85 \uc785\ub825">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1 dark:text-gray-300">\uc0c1\uc138 \uc124\uba85</label>
            <textarea id="todoDesc" rows="2" class="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-mint-400 outline-none dark:bg-slate-700 dark:border-slate-600 dark:text-white" placeholder="\uc5c5\ubb34 \uc124\uba85"></textarea>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-600 mb-1 dark:text-gray-300">\ub2f4\ub2f9\uc790 *</label>
              <select id="todoTeacher" class="w-full px-3 py-2 border border-gray-200 rounded-lg dark:bg-slate-700 dark:border-slate-600 dark:text-white"></select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-600 mb-1 dark:text-gray-300">\uc5c5\ubb34 \uad6c\ubd84</label>
              <select id="todoCategory" class="w-full px-3 py-2 border border-gray-200 rounded-lg dark:bg-slate-700 dark:border-slate-600 dark:text-white">
                <option value="">\uc120\ud0dd \uc548\ud568</option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1 dark:text-gray-300">\ub9c8\uac10 \uae30\ud55c</label>
            <input id="todoDueDate" type="date" class="w-full px-3 py-2 border border-gray-200 rounded-lg dark:bg-slate-700 dark:border-slate-600 dark:text-white">
          </div>
        </div>
        <div class="flex justify-end space-x-3 mt-6">
          <button onclick="closeTodoModal()" class="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium dark:text-gray-300">\ucde8\uc18c</button>
          <button onclick="saveTodo()" class="bg-mint-500 hover:bg-mint-600 text-white px-6 py-2 rounded-lg font-medium transition">\uc800\uc7a5</button>
        </div>
        <input type="hidden" id="editTodoId" value="">
      </div>
    </div>
  </div>

  <!-- Admin Login Modal -->
  <div id="adminLoginModal" class="fixed inset-0 z-50 hidden">
    <div class="modal-overlay absolute inset-0" onclick="closeAdminLogin()"></div>
    <div class="relative flex items-center justify-center min-h-screen p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 relative z-10 modal-anim dark:bg-slate-800">
        <h3 class="text-lg font-bold text-gray-800 mb-4 dark:text-white">
          <i class="fas fa-shield-alt text-yellow-500 mr-2"></i>\uad00\ub9ac\uc790 \uc778\uc99d
        </h3>
        <input id="adminPassword" type="password" placeholder="\uad00\ub9ac\uc790 \ube44\ubc00\ubc88\ud638" 
          class="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-yellow-400 outline-none dark:bg-slate-700 dark:border-slate-600 dark:text-white"
          onkeydown="if(event.key==='Enter')verifyAdmin()">
        <p id="adminError" class="text-red-500 text-sm mt-2 hidden"></p>
        <div class="flex justify-end space-x-3 mt-4">
          <button onclick="closeAdminLogin()" class="px-4 py-2 text-gray-600 dark:text-gray-300">\ucde8\uc18c</button>
          <button onclick="verifyAdmin()" class="bg-yellow-500 hover:bg-yellow-600 text-white px-6 py-2 rounded-lg font-medium transition">\ud655\uc778</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Admin Panel Modal -->
  <div id="adminPanelModal" class="fixed inset-0 z-50 hidden">
    <div class="modal-overlay absolute inset-0" onclick="closeAdminPanel()"></div>
    <div class="relative flex items-center justify-center min-h-screen p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 relative z-10 modal-anim dark:bg-slate-800">
        <h3 class="text-lg font-bold text-gray-800 mb-6 dark:text-white">
          <i class="fas fa-users-cog text-yellow-500 mr-2"></i>\uad00\ub9ac\uc790 \ud328\ub110
        </h3>
        
        <!-- Motto Section -->
        <div class="mb-6 p-4 bg-blue-50 rounded-xl border border-blue-100 dark:bg-slate-700 dark:border-slate-600">
          <h4 class="font-semibold text-gray-700 mb-3 dark:text-gray-200"><i class="fas fa-quote-left mr-2 text-blue-500"></i>Sharing a message (\ub300\uc2dc\ubcf4\ub4dc \ubb38\uad6c)</h4>
          <div class="flex gap-2">
            <input id="mottoInput" type="text" placeholder="\ubd80\uc11c\uc6d0\ub4e4\uc5d0\uac8c \uc804\ud560 \ubb38\uad6c\ub97c \uc785\ub825\ud558\uc138\uc694..." class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm dark:bg-slate-600 dark:border-slate-500 dark:text-white">
            <button onclick="saveMotto()" class="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-600 transition"><i class="fas fa-save mr-1"></i>\uc800\uc7a5</button>
          </div>
        </div>

        <div class="grid md:grid-cols-2 gap-6">
          <div>
            <h4 class="font-semibold text-gray-700 mb-3 dark:text-gray-200"><i class="fas fa-users mr-2 text-mint-500"></i>\ubd80\uc11c\uc6d0 \uad00\ub9ac</h4>
            <div class="flex gap-2 mb-3">
              <input id="newTeacherName" type="text" placeholder="\uc120\uc0dd\ub2d8 \uc774\ub984" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-white">
              <button onclick="addTeacher()" class="bg-mint-500 text-white px-3 py-2 rounded-lg text-sm hover:bg-mint-600 transition"><i class="fas fa-plus"></i></button>
            </div>
            <div id="teacherList" class="space-y-2 max-h-48 overflow-y-auto"></div>
          </div>
          <div>
            <h4 class="font-semibold text-gray-700 mb-3 dark:text-gray-200"><i class="fas fa-tags mr-2 text-mint-500"></i>\uc5c5\ubb34 \uad6c\ubd84 \uad00\ub9ac</h4>
            <div class="flex gap-2 mb-3">
              <input id="newCategoryName" type="text" placeholder="\uad6c\ubd84 \uc774\ub984" class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-white">
              <input id="newCategoryColor" type="color" value="#5EEAD4" class="w-10 h-10 rounded-lg cursor-pointer border-0">
              <button onclick="addCategory()" class="bg-mint-500 text-white px-3 py-2 rounded-lg text-sm hover:bg-mint-600 transition"><i class="fas fa-plus"></i></button>
            </div>
            <div id="categoryList" class="space-y-2 max-h-48 overflow-y-auto"></div>
          </div>
        </div>
        
        <div class="flex justify-end mt-6">
          <button onclick="closeAdminPanel()" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition">\ub2eb\uae30</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Chat / Comment Modal -->
  <div id="commentModal" class="fixed inset-0 z-50 hidden">
    <div class="modal-overlay absolute inset-0" onclick="closeCommentModal()"></div>
    <div class="relative flex items-center justify-center min-h-screen p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col relative z-10 modal-anim dark:bg-slate-800" style="max-height:85vh;">
        <div class="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
          <h3 class="text-lg font-bold text-gray-800 dark:text-white">
            <i class="fas fa-comments text-mint-500 mr-2"></i>\ud1a1 <span id="chatTodoTitle" class="text-sm font-normal text-gray-500 dark:text-gray-400"></span>
          </h3>
          <button onclick="closeCommentModal()" class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div id="commentList" class="flex-1 overflow-y-auto p-4 space-y-3" style="min-height:200px;max-height:400px;"></div>
        <!-- Chat Input -->
        <div class="p-4 border-t border-gray-100 dark:border-slate-700 relative">
          <div id="phraseSuggestions" class="phrase-dropdown hidden bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg shadow-lg mb-2">
          </div>
          <div id="chatAdminToggle" class="hidden mb-2">
            <label class="inline-flex items-center gap-2 text-xs bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 px-3 py-1.5 rounded-full cursor-pointer border border-yellow-200 dark:border-yellow-800">
              <input type="checkbox" id="chatAsAdmin" class="rounded border-yellow-400 text-yellow-500 focus:ring-yellow-400" checked>
              <i class="fas fa-shield-alt"></i> \uad00\ub9ac\uc790\ub85c \uc791\uc131
            </label>
          </div>
          <div class="flex gap-2">
            <input id="commentInput" type="text" placeholder="\uba54\uc2dc\uc9c0 \uc785\ub825..." 
              class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-white"
              oninput="onChatInput()" onkeydown="if(event.key==='Enter')addComment()">
            <button onclick="addComment()" class="bg-mint-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-mint-600 transition">
              <i class="fas fa-paper-plane"></i>
            </button>
          </div>
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
    let frequentPhrases = [];
    let completedFilterActive = false;
    let currentStatusFilter = '';
    let activeCardFilter = null;

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
      document.getElementById('loginError').classList.add('hidden');
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

    function closeAdminLogin() { document.getElementById('adminLoginModal').classList.add('hidden'); }

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
      await fetch('/api/seed', { method: 'POST' });
      await loadTeachers();
      await loadCategories();
      await loadTodos();
      await loadStats();
      await loadPhrases();
    }

    function updateAdminUI() {
      const isAdmin = currentRole === 'admin';
      document.getElementById('adminBadge').classList.toggle('hidden', !isAdmin);
      document.getElementById('adminMgmtBtn').classList.toggle('hidden', !isAdmin);
      const cogIcon = document.getElementById('adminToggleBtn').querySelector('i');
      cogIcon.className = isAdmin ? 'fas fa-user text-yellow-300' : 'fas fa-cog';
    }

    // ===== Completed Filter =====
    function toggleCompletedFilter() {
      completedFilterActive = !completedFilterActive;
      const btn = document.getElementById('completedFilterBtn');
      if (completedFilterActive) {
        currentStatusFilter = 'completed';
        btn.className = 'px-3 py-1.5 bg-green-500 hover:bg-green-600 rounded-lg text-xs sm:text-sm font-medium transition flex items-center gap-1 text-white shadow-lg';
      } else {
        currentStatusFilter = '';
        btn.className = 'px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-xs sm:text-sm font-medium transition flex items-center gap-1';
      }
      loadTodos();
    }

    // ===== Dark Mode =====
    function toggleDarkMode() {
      darkMode = !darkMode;
      document.documentElement.classList.toggle('dark', darkMode);
      document.body.classList.toggle('bg-gray-50', !darkMode);
      document.body.classList.toggle('bg-slate-900', darkMode);
      document.getElementById('darkModeIcon').className = darkMode ? 'fas fa-sun' : 'fas fa-moon';
    }

    // ===== Mobile Search =====
    function toggleMobileSearch() { document.getElementById('mobileSearch').classList.toggle('hidden'); }
    function handleSearch() { loadTodos(); }
    function handleMobileSearch() {
      document.getElementById('searchInput').value = document.getElementById('mobileSearchInput').value;
      loadTodos();
    }

    // ===== Period Filter =====
    function setPeriod(p) {
      currentPeriod = p;
      ['All','Day','Week','Month'].forEach(k => {
        const btn = document.getElementById('period' + k);
        btn.className = k.toLowerCase() === p
          ? 'px-3 py-1.5 rounded-md text-sm font-medium transition-all bg-mint-500 text-white'
          : 'px-3 py-1.5 rounded-md text-sm font-medium transition-all text-gray-600 hover:text-gray-800 dark:text-gray-300';
      });
      loadTodos();
    }

    // ===== Data Loading =====
    async function loadTeachers() {
      const res = await fetch('/api/teachers');
      teachersData = await res.json();
      const filterSelect = document.getElementById('filterTeacher');
      filterSelect.innerHTML = '<option value="">\ubaa8\ub4e0 \ub2f4\ub2f9\uc790</option>';
      teachersData.forEach(t => { filterSelect.innerHTML += '<option value="'+t.id+'">'+t.name+'</option>'; });
      const todoSelect = document.getElementById('todoTeacher');
      todoSelect.innerHTML = '<option value="">\uc120\ud0dd</option>';
      teachersData.forEach(t => { todoSelect.innerHTML += '<option value="'+t.id+'">'+t.name+'</option>'; });
    }

    async function loadCategories() {
      const res = await fetch('/api/categories');
      categoriesData = await res.json();
      const filterSelect = document.getElementById('filterCategory');
      filterSelect.innerHTML = '<option value="">\ubaa8\ub4e0 \uc5c5\ubb34\uad6c\ubd84</option>';
      categoriesData.forEach(c => { filterSelect.innerHTML += '<option value="'+c.id+'">'+c.name+'</option>'; });
      const todoSelect = document.getElementById('todoCategory');
      todoSelect.innerHTML = '<option value="">\uc120\ud0dd \uc548\ud568</option>';
      categoriesData.forEach(c => { todoSelect.innerHTML += '<option value="'+c.id+'">'+c.name+'</option>'; });
    }

    async function loadPhrases() {
      const res = await fetch('/api/phrases');
      frequentPhrases = await res.json();
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
        category_id: categoryId,
        status: currentStatusFilter
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
      document.getElementById('statMotto').textContent = stats.motto || '\uad00\ub9ac\uc790\uac00 \uba54\uc2dc\uc9c0\ub97c \uc124\uc815\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.';
    }

    // ===== Status Helpers =====
    function getStatusLabel(status) {
      const map = { completed: '\uc644\ub8cc', working: '\uc791\uc5c5\uc911', reported: '\uad00\ubcf4\uace0(\uc644)', hold: '\ubcf4\ub958' };
      return map[status] || '\uc791\uc5c5\uc911';
    }

    function getStatusBadge(todo) {
      const s = todo.status || 'working';
      if (s === 'completed') return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><i class="fas fa-check-circle mr-1"><\\/i>\uc644\ub8cc</span>';
      if (s === 'reported') return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"><i class="fas fa-flag mr-1"><\\/i>\uad00\ubcf4\uace0(\uc644)</span>';
      if (s === 'hold') return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200"><i class="fas fa-pause-circle mr-1"><\\/i>\ubcf4\ub958</span>';
      return '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"><i class="fas fa-spinner mr-1"><\\/i>\uc791\uc5c5\uc911</span>';
    }

    function getProgressColor(p) {
      if (p === 100) return 'text-green-600 dark:text-green-400';
      if (p >= 75) return 'text-mint-600 dark:text-mint-400';
      if (p >= 50) return 'text-blue-600 dark:text-blue-400';
      if (p >= 25) return 'text-yellow-600 dark:text-yellow-400';
      return 'text-gray-500 dark:text-gray-400';
    }

    function getProgressLabel(progress) {
      if (progress === 0) return '\ubbf8\uc2dc\uc791';
      if (progress <= 25) return '1\ub2e8\uacc4: \uc2dc\uc791';
      if (progress <= 50) return '2\ub2e8\uacc4: \uc911\uac04';
      if (progress <= 75) return '3\ub2e8\uacc4: \ubc1c\uc804';
      if (progress < 100) return '4\ub2e8\uacc4: \ub9c8\ubb34\ub9ac';
      return '\uc644\ub8cc';
    }

    function getDueDateClass(dueDate) {
      if (!dueDate) return '';
      const today = new Date(); today.setHours(0,0,0,0);
      const due = new Date(dueDate);
      const diff = Math.ceil((due - today) / (1000*60*60*24));
      if (diff < 0) return 'text-red-600 font-semibold';
      if (diff <= 2) return 'text-orange-500 font-medium';
      return 'text-gray-600 dark:text-gray-400';
    }

    // ===== Render Todos =====
    function renderTodos() {
      const container = document.getElementById('todoList');
      const isAdmin = currentRole === 'admin';

      if (todosData.length === 0) {
        container.innerHTML = '<div class="p-12 text-center text-gray-400 slide-up"><i class="fas fa-inbox text-4xl mb-3"><\\/i><p class="text-lg">\ud560 \uc77c\uc774 \uc5c6\uc2b5\ub2c8\ub2e4</p><p class="text-sm mt-1">\uc0c8\ub85c\uc6b4 \ud560 \uc77c\uc744 \ucd94\uac00\ud574 \uc8fc\uc138\uc694</p></div>';
        return;
      }

      let html = '';
      todosData.forEach((todo, idx) => {
        const catColor = todo.category_color || '#5EEAD4';
        const isPrivate = todo.is_private;
        const commentBadge = todo.comment_count > 0 ? '<span class="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-mint-100 text-mint-700 text-xs font-bold dark:bg-mint-900 dark:text-mint-200">' + todo.comment_count + '</span>' : '';
        const isCompleted = todo.status === 'completed';
        const isDisabled = isCompleted;
        const delay = Math.min(idx * 0.04, 0.5);

        // Desktop Row
        html += '<div class="hidden md:grid grid-cols-12 gap-2 px-6 py-4 todo-row items-center ' + (isPrivate ? 'opacity-60 bg-gray-50 dark:bg-slate-900' : '') + (isCompleted ? ' bg-green-50/50 dark:bg-green-900/10' : '') + ' slide-up" style="animation-delay:'+delay+'s">';
        
        html += '<div class="col-span-1"><span class="inline-block px-2 py-1 rounded-md text-xs font-medium text-white" style="background-color:'+catColor+'">'+(todo.category_name||'\ubbf8\ubd84\ub958')+'</span></div>';
        
        html += '<div class="col-span-3">';
        if (isPrivate && isAdmin) html += '<i class="fas fa-lock text-yellow-500 mr-1 text-xs"><\\/i>';
        html += '<span class="text-sm font-medium text-gray-800 dark:text-white cursor-pointer hover:text-mint-600 transition-colors '+(isCompleted?'line-through opacity-70':'')+'" onclick="startInlineEdit(this, '+todo.id+', \\x27title\\x27)">'+todo.title+'</span>';
        html += '</div>';
        
        html += '<div class="col-span-1"><span class="text-sm text-gray-600 dark:text-gray-300">'+(todo.teacher_name||'-')+'</span></div>';
        html += '<div class="col-span-1"><span class="text-xs '+getDueDateClass(todo.due_date)+'">'+(todo.due_date || '-')+'</span></div>';
        
        // Progress Slider (compact 2/3)
        html += '<div class="col-span-3 flex items-center gap-2">';
        html += '<div class="progress-compact flex-1"><input type="range" min="0" max="100" value="'+todo.progress+'" class="w-full slider-bg" '+(isDisabled ? 'disabled' : '')+' onchange="updateProgress('+todo.id+', this.value)" oninput="updateProgressDisplay(this)"></div>';
        html += '<span class="text-xs font-bold w-10 text-right tabular-nums '+getProgressColor(todo.progress)+'">'+todo.progress+'%</span>';
        html += '</div>';
        
        html += '<div class="col-span-1">'+getStatusBadge(todo)+'</div>';
        
        // Actions
        html += '<div class="col-span-2 flex items-center justify-end gap-1">';
        html += '<button onclick="showComments('+todo.id+')" class="p-1.5 text-gray-400 hover:text-mint-600 transition relative" title="\ud1a1"><i class="fas fa-comment-dots"><\\/i>'+commentBadge+'</button>';
        
        if (isAdmin) {
          html += '<button onclick="togglePrivate('+todo.id+', '+(!isPrivate)+')" class="p-1.5 '+(isPrivate ? 'text-yellow-500' : 'text-gray-400')+' hover:text-yellow-600 transition" title="\ube44\uacf5\uac1c"><i class="fas '+(isPrivate ? 'fa-lock' : 'fa-lock-open')+'"><\\/i></button>';
          if (todo.status === 'reported') {
            html += '<button onclick="approveTodo('+todo.id+')" class="p-1.5 text-green-500 hover:text-green-700 transition animate-pulse" title="\ud655\uc778 \uc644\ub8cc"><i class="fas fa-check-double"><\\/i></button>';
          }
          html += '<select onchange="updateStatus('+todo.id+', this.value)" class="text-xs border border-gray-200 rounded px-1 py-0.5 dark:bg-slate-700 dark:border-slate-600 dark:text-white" style="max-width:85px;">';
          ['working','reported','hold','completed'].forEach(s => {
            html += '<option value="'+s+'"'+((todo.status===s)?' selected':'')+'>'+getStatusLabel(s)+'</option>';
          });
          html += '</select>';
        }
        
        html += '<button onclick="editTodo('+todo.id+')" class="p-1.5 text-gray-400 hover:text-blue-600 transition" title="\uc218\uc815"><i class="fas fa-pen"><\\/i></button>';
        html += '<button onclick="deleteTodo('+todo.id+')" class="p-1.5 text-gray-400 hover:text-red-600 transition" title="\uc0ad\uc81c"><i class="fas fa-trash"><\\/i></button>';
        html += '</div></div>';

        // Mobile Card
        html += '<div class="md:hidden p-4 border-b border-gray-100 dark:border-slate-700 ' + (isPrivate ? 'opacity-60 bg-gray-50 dark:bg-slate-900' : '') + (isCompleted ? ' bg-green-50/50' : '') + ' slide-up" style="animation-delay:'+delay+'s">';
        html += '<div class="flex items-center justify-between mb-2">';
        html += '<div class="flex items-center gap-2">';
        html += '<span class="inline-block px-2 py-0.5 rounded-md text-xs font-medium text-white" style="background-color:'+catColor+'">'+(todo.category_name||'\ubbf8\ubd84\ub958')+'</span>';
        html += getStatusBadge(todo);
        html += '</div>';
        html += '<div class="flex items-center gap-1">';
        html += '<button onclick="showComments('+todo.id+')" class="p-1 text-gray-400 hover:text-mint-600 text-sm"><i class="fas fa-comment-dots"><\\/i>'+commentBadge+'</button>';
        if (isAdmin) {
          if (todo.status === 'reported') {
            html += '<button onclick="approveTodo('+todo.id+')" class="p-1 text-green-500 text-sm animate-pulse"><i class="fas fa-check-double"><\\/i></button>';
          }
        }
        html += '<button onclick="editTodo('+todo.id+')" class="p-1 text-gray-400 text-sm"><i class="fas fa-pen"><\\/i></button>';
        html += '<button onclick="deleteTodo('+todo.id+')" class="p-1 text-gray-400 text-sm"><i class="fas fa-trash"><\\/i></button>';
        html += '</div></div>';
        html += '<h4 class="font-medium text-gray-800 dark:text-white text-sm mb-1 '+(isCompleted?'line-through opacity-70':'')+'">'+todo.title+'</h4>';
        html += '<div class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-2">';
        html += '<span><i class="fas fa-user mr-1"><\\/i>'+(todo.teacher_name||'-')+'</span>';
        html += '<span class="'+getDueDateClass(todo.due_date)+'"><i class="fas fa-calendar mr-1"><\\/i>'+(todo.due_date||'\uae30\ud55c \uc5c6\uc74c')+'</span>';
        html += '</div>';
        html += '<div class="flex items-center gap-2 mb-1">';
        html += '<div class="progress-compact flex-1"><input type="range" min="0" max="100" value="'+todo.progress+'" class="w-full slider-bg" '+(isDisabled ? 'disabled' : '')+' onchange="updateProgress('+todo.id+', this.value)" oninput="updateProgressDisplay(this)"></div>';
        html += '<span class="text-xs font-bold w-10 text-right tabular-nums '+getProgressColor(todo.progress)+'">'+todo.progress+'%</span>';
        html += '</div>';
        html += '<div class="text-xs text-gray-400">'+getProgressLabel(todo.progress)+'</div>';
        html += '</div>';
      });

      container.innerHTML = html;
    }

    // ===== Progress Display Update (real-time) =====
    function updateProgressDisplay(slider) {
      const span = slider.closest('.flex').querySelector('span');
      if (!span) return;
      span.textContent = slider.value + '%';
      const v = parseInt(slider.value);
      const base = 'text-xs font-bold w-10 text-right tabular-nums ';
      if (v === 100) { span.className = base + 'text-green-600 dark:text-green-400'; }
      else if (v >= 75) { span.className = base + 'text-mint-600 dark:text-mint-400'; }
      else if (v >= 50) { span.className = base + 'text-blue-600 dark:text-blue-400'; }
      else if (v >= 25) { span.className = base + 'text-yellow-600 dark:text-yellow-400'; }
      else { span.className = base + 'text-gray-500 dark:text-gray-400'; }
    }

    // ===== CRUD =====
    function showAddTodoModal() {
      document.getElementById('todoModalTitle').innerHTML = '<i class="fas fa-plus-circle text-mint-500 mr-2"><\\/i>\uc0c8 \ud560 \uc77c \ucd94\uac00';
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
      document.getElementById('todoModalTitle').innerHTML = '<i class="fas fa-edit text-blue-500 mr-2"><\\/i>\ud560 \uc77c \uc218\uc815';
      document.getElementById('todoTitle').value = todo.title;
      document.getElementById('todoDesc').value = todo.description || '';
      document.getElementById('todoTeacher').value = todo.teacher_id;
      document.getElementById('todoCategory').value = todo.category_id || '';
      document.getElementById('todoDueDate').value = todo.due_date || '';
      document.getElementById('editTodoId').value = id;
      document.getElementById('todoModal').classList.remove('hidden');
    }

    function closeTodoModal() { document.getElementById('todoModal').classList.add('hidden'); }

    async function saveTodo() {
      const id = document.getElementById('editTodoId').value;
      const title = document.getElementById('todoTitle').value.trim();
      const desc = document.getElementById('todoDesc').value.trim();
      const teacherId = document.getElementById('todoTeacher').value;
      const categoryId = document.getElementById('todoCategory').value;
      const dueDate = document.getElementById('todoDueDate').value;
      if (!title) { alert('\uc5c5\ubb34\uba85\uc744 \uc785\ub825\ud574 \uc8fc\uc138\uc694.'); return; }
      if (!teacherId) { alert('\ub2f4\ub2f9\uc790\ub97c \uc120\ud0dd\ud574 \uc8fc\uc138\uc694.'); return; }
      const body = { title, description: desc, teacher_id: parseInt(teacherId), category_id: categoryId ? parseInt(categoryId) : null, due_date: dueDate || null };
      if (id) {
        await fetch('/api/todos/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        await fetch('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      closeTodoModal();
      loadTodos();
      loadStats();
    }

    async function deleteTodo(id) {
      if (!confirm('\uc774 \ud56d\ubaa9\uc744 \uc0ad\uc81c\ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c?')) return;
      await fetch('/api/todos/' + id, { method: 'DELETE' });
      loadTodos(); loadStats();
    }

    async function updateProgress(id, value) {
      const v = parseInt(value);
      const updates = { progress: v };
      if (v === 100) { updates.status = 'reported'; }
      await fetch('/api/todos/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
      loadTodos(); loadStats();
    }

    async function updateStatus(id, status) {
      await fetch('/api/todos/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      loadTodos(); loadStats();
    }

    async function togglePrivate(id, isPrivate) {
      await fetch('/api/todos/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_private: isPrivate }) });
      loadTodos();
    }

    async function approveTodo(id) {
      if (!confirm('\uc774 \uc5c5\ubb34\ub97c \ud655\uc778 \uc644\ub8cc \ucc98\ub9ac\ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c?')) return;
      await fetch('/api/todos/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_approved: true, status: 'completed' }) });
      loadTodos(); loadStats();
    }

    // ===== Inline Editing =====
    function startInlineEdit(el, id, field) {
      const currentText = el.textContent;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentText;
      input.className = 'px-2 py-1 border border-mint-400 rounded text-sm w-full focus:ring-2 focus:ring-mint-400 outline-none dark:bg-slate-700 dark:text-white';
      input.onblur = () => saveInlineEdit(input, el, id, field, currentText);
      input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { el.textContent = currentText; input.replaceWith(el); } };
      el.replaceWith(input);
      input.focus(); input.select();
    }

    async function saveInlineEdit(input, originalEl, id, field, originalText) {
      const newValue = input.value.trim();
      if (newValue && newValue !== originalText) {
        await fetch('/api/todos/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: newValue }) });
        loadTodos();
      } else { originalEl.textContent = originalText; input.replaceWith(originalEl); }
    }

    // ===== Chat/Comments =====
    async function showComments(todoId) {
      document.getElementById('commentTodoId').value = todoId;
      document.getElementById('commentModal').classList.remove('hidden');
      const todo = todosData.find(t => t.id === todoId);
      document.getElementById('chatTodoTitle').textContent = todo ? '- ' + todo.title : '';
      // Show/hide admin toggle
      const adminToggle = document.getElementById('chatAdminToggle');
      if (currentRole === 'admin') {
        adminToggle.classList.remove('hidden');
        document.getElementById('chatAsAdmin').checked = true;
      } else {
        adminToggle.classList.add('hidden');
      }

      const res = await fetch('/api/todos/' + todoId + '/comments');
      const comments = await res.json();
      
      const container = document.getElementById('commentList');
      if (comments.length === 0) {
        container.innerHTML = '<div class="text-center text-gray-400 py-8"><i class="fas fa-comment-slash text-3xl mb-2"><\\/i><p class="text-sm">\uc544\uc9c1 \uba54\uc2dc\uc9c0\uac00 \uc5c6\uc2b5\ub2c8\ub2e4</p><p class="text-xs mt-1">\ud1a1\uc744 \ubcf4\ub0b4\ubcf4\uc138\uc694!</p></div>';
      } else {
        container.innerHTML = comments.map(c => {
          const isAdminMsg = c.author_type === 'admin';
          return '<div class="flex '+(isAdminMsg ? 'justify-start' : 'justify-end')+' scale-in">' +
          '<div class="max-w-[80%] '+(isAdminMsg ? 'chat-bubble-admin' : 'chat-bubble-user')+' px-3 py-2 relative group">' +
          '<div class="flex items-center gap-1 mb-0.5">' +
          '<span class="text-xs font-semibold '+(isAdminMsg ? 'text-mint-700 dark:text-mint-300' : 'text-indigo-700 dark:text-indigo-300')+'">'+(isAdminMsg ? '<i class="fas fa-shield-alt mr-1"><\\/i>\uad00\ub9ac\uc790' : '<i class="fas fa-user mr-1"><\\/i>'+(c.author_name||'\ub2f4\ub2f9\uc790'))+'</span>' +
          '</div>' +
          '<p class="text-sm text-gray-700 dark:text-gray-200">' + c.content + '</p>' +
          '<p class="text-xs text-gray-400 mt-1">' + new Date(c.created_at).toLocaleString('ko-KR') + '</p>' +
          (currentRole === 'admin' ? '<button onclick="deleteComment('+c.id+', '+todoId+')" class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs hidden group-hover:flex items-center justify-center"><i class="fas fa-times"><\\/i></button>' : '') +
          '</div></div>';
        }).join('');
        container.scrollTop = container.scrollHeight;
      }
    }

    function closeCommentModal() {
      document.getElementById('commentModal').classList.add('hidden');
      document.getElementById('phraseSuggestions').classList.add('hidden');
    }

    function onChatInput() {
      const input = document.getElementById('commentInput');
      const val = input.value.trim().toLowerCase();
      const sugBox = document.getElementById('phraseSuggestions');
      
      if (val.length < 1) { sugBox.classList.add('hidden'); return; }
      
      const matches = frequentPhrases.filter(p => p.phrase.toLowerCase().includes(val)).slice(0, 5);
      if (matches.length === 0) { sugBox.classList.add('hidden'); return; }
      
      sugBox.innerHTML = matches.map(p =>
        '<div class="px-3 py-2 hover:bg-mint-50 dark:hover:bg-slate-600 cursor-pointer text-sm text-gray-700 dark:text-gray-200 border-b border-gray-100 dark:border-slate-600 last:border-0" onclick="selectPhrase(this.textContent)">' + p.phrase + '</div>'
      ).join('');
      sugBox.classList.remove('hidden');
    }

    function selectPhrase(phrase) {
      document.getElementById('commentInput').value = phrase;
      document.getElementById('phraseSuggestions').classList.add('hidden');
    }

    async function addComment() {
      const todoId = document.getElementById('commentTodoId').value;
      const content = document.getElementById('commentInput').value.trim();
      if (!content) return;
      
      const todo = todosData.find(t => t.id == todoId);
      let authorType = 'user';
      let authorName = todo ? todo.teacher_name : '';
      if (currentRole === 'admin') {
        const asAdmin = document.getElementById('chatAsAdmin').checked;
        authorType = asAdmin ? 'admin' : 'user';
        authorName = asAdmin ? '' : (todo ? todo.teacher_name : '');
      }

      await fetch('/api/todos/' + todoId + '/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, author_type: authorType, author_name: authorName })
      });
      
      document.getElementById('commentInput').value = '';
      document.getElementById('phraseSuggestions').classList.add('hidden');
      await showComments(parseInt(todoId));
      await loadTodos();
      await loadPhrases();
    }

    async function deleteComment(commentId, todoId) {
      await fetch('/api/comments/' + commentId, { method: 'DELETE' });
      showComments(todoId);
      loadTodos();
    }

    // ===== Card Detail =====
    async function openCardDetail(type) {
      if (activeCardFilter === type) { closeCardDetail(); return; }
      activeCardFilter = type;
      // Highlight active card
      ['total','working','reported'].forEach(k => {
        const card = document.getElementById('card-' + k);
        if (card) card.classList.toggle('card-active', k === type);
      });
      const panel = document.getElementById('cardDetailPanel');
      const titleEl = document.getElementById('cardDetailTitle');
      const listEl = document.getElementById('cardDetailList');
      
      const titles = { total: '\uc804\uccb4 \ud560 \uc77c', working: '\uc791\uc5c5 \uc911', reported: '\uad00\ubcf4\uace0(\uc644)' };
      const icons = { total: 'fa-list-check', working: 'fa-spinner', reported: 'fa-flag-checkered' };
      titleEl.innerHTML = '<i class="fas '+icons[type]+' mr-2 text-mint-500"><\\/i>' + titles[type] + ' \ubaa9\ub85d (\ucd5c\uc2e0\uc21c)';

      const isAdmin = currentRole === 'admin';
      let params = 'admin=' + isAdmin + '&period=all';
      if (type !== 'total') params += '&status=' + type;
      
      const res = await fetch('/api/todos?' + params);
      let items = await res.json();
      items.sort((a,b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

      if (items.length === 0) {
        listEl.innerHTML = '<div class="p-6 text-center text-gray-400 text-sm"><i class="fas fa-inbox text-2xl mb-2"><\\/i><p>\ud56d\ubaa9\uc774 \uc5c6\uc2b5\ub2c8\ub2e4</p></div>';
      } else {
        listEl.innerHTML = items.map(t => {
          const catColor = t.category_color || '#5EEAD4';
          return '<div class="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-slate-750 transition">' +
            '<span class="inline-block px-2 py-0.5 rounded text-xs font-medium text-white flex-shrink-0" style="background-color:'+catColor+'">'+(t.category_name||'\ubbf8\ubd84\ub958')+'</span>' +
            '<span class="flex-1 text-sm text-gray-800 dark:text-gray-200 truncate">'+t.title+'</span>' +
            '<span class="text-xs text-gray-500 flex-shrink-0">'+(t.teacher_name||'-')+'</span>' +
            '<span class="text-xs font-bold flex-shrink-0 '+getProgressColor(t.progress)+'">'+t.progress+'%</span>' +
            getStatusBadge(t) +
          '</div>';
        }).join('');
      }
      panel.classList.remove('hidden');
    }

    function closeCardDetail() {
      activeCardFilter = null;
      ['total','working','reported'].forEach(k => {
        const card = document.getElementById('card-' + k);
        if (card) card.classList.remove('card-active');
      });
      document.getElementById('cardDetailPanel').classList.add('hidden');
    }

    // ===== Admin Panel =====
    function showAdminPanel() {
      document.getElementById('adminPanelModal').classList.remove('hidden');
      renderAdminTeachers();
      renderAdminCategories();
      fetch('/api/settings/admin_motto').then(r=>r.json()).then(d => {
        document.getElementById('mottoInput').value = d.value || '';
      });
    }

    function closeAdminPanel() { document.getElementById('adminPanelModal').classList.add('hidden'); }

    async function saveMotto() {
      const val = document.getElementById('mottoInput').value.trim();
      await fetch('/api/settings/admin_motto', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: val }) });
      loadStats();
      alert('\ubb38\uad6c\uac00 \uc800\uc7a5\ub418\uc5c8\uc2b5\ub2c8\ub2e4!');
    }

    function renderAdminTeachers() {
      document.getElementById('teacherList').innerHTML = teachersData.map(t =>
        '<div class="flex items-center justify-between bg-gray-50 dark:bg-slate-700 px-3 py-2 rounded-lg">' +
        '<span class="text-sm text-gray-700 dark:text-gray-200"><i class="fas fa-user text-mint-500 mr-2"><\\/i>' + t.name + '</span>' +
        '<button onclick="deleteTeacher('+t.id+')" class="text-red-400 hover:text-red-600 text-sm"><i class="fas fa-trash"><\\/i></button></div>'
      ).join('');
    }

    function renderAdminCategories() {
      document.getElementById('categoryList').innerHTML = categoriesData.map(c =>
        '<div class="flex items-center justify-between bg-gray-50 dark:bg-slate-700 px-3 py-2 rounded-lg">' +
        '<div class="flex items-center gap-2"><div class="w-4 h-4 rounded" style="background-color:'+c.color+'"></div>' +
        '<span class="text-sm text-gray-700 dark:text-gray-200">' + c.name + '</span></div>' +
        '<button onclick="deleteCategory('+c.id+')" class="text-red-400 hover:text-red-600 text-sm"><i class="fas fa-trash"><\\/i></button></div>'
      ).join('');
    }

    async function addTeacher() {
      const name = document.getElementById('newTeacherName').value.trim();
      if (!name) return;
      await fetch('/api/teachers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      document.getElementById('newTeacherName').value = '';
      await loadTeachers(); renderAdminTeachers();
    }

    async function deleteTeacher(id) {
      if (!confirm('\uc0ad\uc81c\ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c?')) return;
      await fetch('/api/teachers/' + id, { method: 'DELETE' });
      await loadTeachers(); renderAdminTeachers();
    }

    async function addCategory() {
      const name = document.getElementById('newCategoryName').value.trim();
      const color = document.getElementById('newCategoryColor').value;
      if (!name) return;
      await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color }) });
      document.getElementById('newCategoryName').value = '';
      await loadCategories(); renderAdminCategories();
    }

    async function deleteCategory(id) {
      if (!confirm('\uc0ad\uc81c\ud558\uc2dc\uaca0\uc2b5\ub2c8\uae4c?')) return;
      await fetch('/api/categories/' + id, { method: 'DELETE' });
      await loadCategories(); renderAdminCategories();
    }

    // ===== Excel Export =====
    function exportExcel() {
      const data = todosData.map(t => ({
        '\uc5c5\ubb34\uad6c\ubd84': t.category_name || '\ubbf8\ubd84\ub958',
        '\uc5c5\ubb34\uba85': t.title,
        '\uc0c1\uc138\uc124\uba85': t.description || '',
        '\ub2f4\ub2f9\uc790': t.teacher_name || '-',
        '\ub9c8\uac10\uae30\ud55c': t.due_date || '-',
        '\uc9c4\ud589\ub960(%)': t.progress,
        '\uc9c4\ud589\ub2e8\uacc4': getProgressLabel(t.progress),
        '\uc0c1\ud0dc': getStatusLabel(t.status),
        '\ube44\uacf5\uac1c': t.is_private ? 'Y' : 'N',
        '\ud1a1\uc218': t.comment_count || 0
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'To-Do List');
      ws['!cols'] = [{wch:10},{wch:30},{wch:40},{wch:10},{wch:12},{wch:10},{wch:15},{wch:10},{wch:8},{wch:8}];
      XLSX.writeFile(wb, 'TDL_' + new Date().toISOString().slice(0,10) + '.xlsx');
    }

    // ===== Auto Login =====
    window.addEventListener('DOMContentLoaded', () => {
      const savedRole = localStorage.getItem('tdl_role');
      if (savedRole) { currentRole = savedRole; showMainApp(); }
    });
  <\/script>
</body>
</html>`
}

export default app
