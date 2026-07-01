const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']
});
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'sfera_data.json');

// ===== DATABASE (JSON file) =====
let db = { users: [], chats: [], messages: [] };

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch(e) {}
}
function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 0));
}
loadDB();

// ===== HELPERS =====
function hash(str) { return crypto.createHash('sha256').update(str).digest('hex'); }
function uid() { return 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
function cid() { return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

// ===== SEED =====
if (!db.users.find(u => u.login === 'system')) {
  const now = Date.now();
  db.users.push(
    { id: 'system', name: 'Sfera Bot', login: 'system', pass: '', color: '#6C5CE7', online: false, lastSeen: now },
    { id: 'admin', name: 'Админ', login: 'admin', pass: hash('admin'), color: '#ff6b6b', online: false, lastSeen: now },
    { id: 'demo1', name: 'Алексей', login: 'alex', pass: hash('1234'), color: '#00d2d3', online: false, lastSeen: now },
    { id: 'demo2', name: 'Мария', login: 'masha', pass: hash('1234'), color: '#ff9ff3', online: false, lastSeen: now },
    { id: 'demo3', name: 'Дмитрий', login: 'dima', pass: hash('1234'), color: '#feca57', online: false, lastSeen: now }
  );
  db.chats.push({ id: 'group', type: 'group', name: 'Общий чат', members: JSON.stringify(['system','admin','demo1','demo2','demo3']) });
  db.messages.push(
    { chatId: 'group', userId: 'system', text: 'Добро пожаловать в общий чат Sfera!', time: now - 100000 },
    { chatId: 'group', userId: 'demo1', text: 'Привет всем! Как дела?', time: now - 80000 },
    { chatId: 'group', userId: 'demo2', text: 'Привет! Всё отлично', time: now - 60000 },
    { chatId: 'group', userId: 'demo3', text: 'Добро пожаловать новичкам!', time: now - 40000 }
  );
  saveDB();
}

// ===== API =====
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(__dirname));

// Healthcheck for Railway
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.json({ status: 'Sfera is running' }));

app.post('/api/register', (req, res) => {
  const { name, login, pass } = req.body;
  if (!name || !login || !pass) return res.status(400).json({ error: 'Заполни все поля' });
  if (login.length < 3) return res.status(400).json({ error: 'Логин минимум 3 символа' });
  if (pass.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });
  if (db.users.find(u => u.login === login)) return res.status(400).json({ error: 'Логин уже занят' });

  const colors = ['#6C5CE7','#00d2d3','#ff6b6b','#ff9ff3','#feca57','#51cf66','#ffa502','#70a1ff'];
  const user = { id: uid(), name, login, pass: hash(pass), color: colors[Math.floor(Math.random() * colors.length)], online: true, lastSeen: Date.now() };
  db.users.push(user);
  saveDB();
  res.json({ user: { ...user, pass: undefined } });
});

app.post('/api/login', (req, res) => {
  const { login, pass } = req.body;
  if (!login || !pass) return res.status(400).json({ error: 'Заполни все поля' });
  const user = db.users.find(u => u.login === login);
  if (!user || user.pass !== hash(pass)) return res.status(400).json({ error: 'Неверный логин или пароль' });
  user.online = true;
  user.lastSeen = Date.now();
  saveDB();
  res.json({ user: { ...user, pass: undefined } });
});

app.post('/api/logout', (req, res) => {
  const user = db.users.find(u => u.id === req.body.userId);
  if (user) { user.online = false; user.lastSeen = Date.now(); saveDB(); }
  res.json({ ok: true });
});

app.get('/api/users', (req, res) => {
  res.json({ users: db.users.map(u => ({ ...u, pass: undefined })) });
});

app.get('/api/chats/:userId', (req, res) => {
  const userId = req.params.userId;
  const chats = db.chats.filter(c => c.type === 'group' || c.members.includes(userId));
  res.json({ chats: chats.map(c => ({ ...c, messages: db.messages.filter(m => m.chatId === c.id) })) });
});

app.post('/api/chats', (req, res) => {
  const { type, name, members } = req.body;
  const id = cid();
  db.chats.push({ id, type, name: name || null, members: JSON.stringify(members) });
  if (type === 'group') db.messages.push({ chatId: id, userId: 'system', text: 'Чат создан!', time: Date.now() });
  saveDB();
  const chat = db.chats.find(c => c.id === id);
  res.json({ chat: { ...chat, messages: db.messages.filter(m => m.chatId === id) } });
});

app.post('/api/messages', (req, res) => {
  const { chatId, userId, text } = req.body;
  if (!text) return res.status(400).json({ error: 'Пустое сообщение' });
  const msg = { chatId, userId, text, time: Date.now() };
  db.messages.push(msg);
  saveDB();
  io.emit('message', msg);
  res.json({ msg });
});

app.post('/api/voice', (req, res) => {
  try {
    const { chatId, userId, audio, duration } = req.body;
    if (!audio) return res.status(400).json({ error: 'Нет аудио' });
    if (!chatId || !userId) return res.status(400).json({ error: 'Не указан чат или пользователь' });
    const msg = { chatId, userId, text: '', audio, duration: duration || 0, type: 'voice', time: Date.now() };
    db.messages.push(msg);
    saveDB();
    io.emit('message', msg);
    res.json({ msg });
  } catch (e) {
    console.error('Voice error:', e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/profile', (req, res) => {
  const user = db.users.find(u => u.id === req.body.userId);
  if (user) { user.name = req.body.name; saveDB(); }
  res.json({ ok: true });
});

// ===== SOCKET.IO =====
const onlineUsers = new Map();

io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    onlineUsers.set(userId, socket.id);
    const user = db.users.find(u => u.id === userId);
    if (user) { user.online = true; user.lastSeen = Date.now(); saveDB(); }
    io.emit('presence', { userId, online: true });
  });

  socket.on('disconnect', () => {
    for (const [userId, sockId] of onlineUsers) {
      if (sockId === socket.id) {
        onlineUsers.delete(userId);
        const user = db.users.find(u => u.id === userId);
        if (user) { user.online = false; user.lastSeen = Date.now(); saveDB(); }
        io.emit('presence', { userId, online: false });
        break;
      }
    }
  });
});

// ===== AUTOSAVE =====
setInterval(() => saveDB(), 30000);

// ===== ERROR HANDLING =====
process.on('uncaughtException', (e) => console.error('Uncaught:', e));
process.on('unhandledRejection', (e) => console.error('Unhandled:', e));

// ===== START =====
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Sfera server: http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
