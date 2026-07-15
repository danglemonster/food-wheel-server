const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { Redis } = require('@upstash/redis');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const STATE_KEY = 'foodwheel:state';
const MAX_HISTORY = 50;
const MAX_CHAT = 200;

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.warn('⚠️  Chưa cấu hình UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — dữ liệu sẽ KHÔNG được lưu bền vững.');
  console.warn('    Tạo database miễn phí tại https://console.upstash.com rồi set 2 biến môi trường này.');
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

function defaultState() {
  return { items: [], lastSpin: null, spinId: 0, history: [], chat: [], joinedIds: [] };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), ms))
  ]);
}

// ---- Đọc / ghi state trên Upstash Redis (1 key JSON duy nhất, đủ dùng cho quy mô nhỏ) ----
async function loadState() {
  try {
    const raw = await withTimeout(redis.get(STATE_KEY), 4000);
    if (!raw) return defaultState();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      lastSpin: parsed.lastSpin || null,
      spinId: typeof parsed.spinId === 'number' ? parsed.spinId : 0,
      history: Array.isArray(parsed.history) ? parsed.history : [],
      chat: Array.isArray(parsed.chat) ? parsed.chat : [],
      joinedIds: Array.isArray(parsed.joinedIds) ? parsed.joinedIds : []
    };
  } catch (e) {
    console.error('Lỗi đọc dữ liệu từ Redis:', e.message);
    return defaultState();
  }
}

async function saveState() {
  try {
    await withTimeout(redis.set(STATE_KEY, JSON.stringify(state)), 4000);
  } catch (e) {
    console.error('Lỗi lưu dữ liệu vào Redis:', e.message);
  }
}

let state = defaultState();

// ---- Admin tokens (in-memory - mất khi restart, admin đăng nhập lại là được) ----
const adminTokens = new Map();
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function issueToken() {
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}
function isValidToken(token) {
  if (!token) return false;
  const expiry = adminTokens.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) { adminTokens.delete(token); return false; }
  return true;
}
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!isValidToken(token)) {
    return res.status(401).json({ error: 'Bạn không có quyền admin hoặc phiên đã hết hạn.' });
  }
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of adminTokens.entries()) if (now > expiry) adminTokens.delete(token);
}, 60 * 60 * 1000);

// ---- App + HTTP server (dùng chung 1 server cho cả Express và WebSocket) ----
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Mỗi kết nối WS -> { ownerId, name }. Một người có thể có nhiều tab/thiết bị.
const connectedClients = new Map();

function getActiveMembers() {
  const byOwner = new Map();
  for (const info of connectedClients.values()) {
    if (info.ownerId && info.name) byOwner.set(info.ownerId, info.name);
  }
  return Array.from(byOwner.entries())
    .map(([ownerId, name]) => ({ ownerId, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

function statePayload() {
  return JSON.stringify({
    type: 'state',
    items: state.items,
    lastSpin: state.lastSpin,
    spinId: state.spinId,
    history: state.history,
    chat: state.chat,
    members: getActiveMembers()
  });
}

// Đẩy trạng thái mới nhất tới TẤT CẢ client đang kết nối - đây là cơ chế "real-time"
function broadcastState() {
  const payload = statePayload();
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

wss.on('connection', (ws) => {
  connectedClients.set(ws, { ownerId: null, name: null });
  ws.send(statePayload()); // gửi ngay trạng thái hiện tại cho người vừa kết nối

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.type !== 'hello') return;

    const ownerId = typeof msg.ownerId === 'string' ? msg.ownerId.trim() : '';
    const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 30) : '';
    if (!ownerId) return;
    connectedClients.set(ws, { ownerId, name });

    // Người mới thật sự (chưa từng vào phòng) -> ghi thông báo hệ thống vào chat
    if (name && !state.joinedIds.includes(ownerId)) {
      state.joinedIds.push(ownerId);
      state.chat.push({
        id: crypto.randomBytes(6).toString('hex'),
        system: true,
        name,
        ownerId,
        text: `${name} đã tham gia phòng 👋`,
        timestamp: Date.now()
      });
      if (state.chat.length > MAX_CHAT) state.chat.shift();
      await saveState();
    }
    broadcastState(); // cập nhật danh sách thành viên (và chat nếu có) cho mọi người
  });

  ws.on('close', () => {
    connectedClients.delete(ws);
    broadcastState();
  });
});

// ---- REST API: thực hiện thay đổi dữ liệu, rồi phát (broadcast) qua WebSocket ----

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  console.log(ADMIN_PASSWORD);
  if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Sai mật khẩu admin.' });
  }
  res.json({ token: issueToken() });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const auth = req.headers.authorization || '';
  adminTokens.delete(auth.slice(7));
  res.json({ ok: true });
});

// Thêm món (public - ai cũng thêm được, nhưng phải có tên + mã định danh trình duyệt)
app.post('/api/items', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const ownerName = typeof req.body?.ownerName === 'string' ? req.body.ownerName.trim() : '';
  const ownerId = typeof req.body?.ownerId === 'string' ? req.body.ownerId.trim() : '';

  if (!ownerName) return res.status(400).json({ error: 'Thiếu tên người thêm món.' });
  if (!ownerId) return res.status(400).json({ error: 'Thiếu định danh người dùng.' });
  if (ownerName.length > 30) return res.status(400).json({ error: 'Tên quá dài (tối đa 30 ký tự).' });
  if (!name) return res.status(400).json({ error: 'Tên món không được để trống.' });
  if (name.length > 60) return res.status(400).json({ error: 'Tên món quá dài.' });
  if (state.items.length >= 200) return res.status(400).json({ error: 'Danh sách đã đầy (tối đa 200 món).' });

  state.items.push({ id: crypto.randomBytes(6).toString('hex'), name, ownerId, ownerName });
  await saveState();
  broadcastState();
  res.status(201).json({ ok: true });
});

// Xoá 1 món - chủ món đó (đúng ownerId) hoặc admin mới được xoá
app.delete('/api/items/:id', async (req, res) => {
  const item = state.items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Không tìm thấy món này.' });

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const requesterOwnerId = req.headers['x-owner-id'] || '';
  const isOwner = requesterOwnerId && requesterOwnerId === item.ownerId;
  const admin = isValidToken(token);

  if (!isOwner && !admin) {
    return res.status(403).json({ error: 'Bạn chỉ có thể xoá món do chính mình thêm.' });
  }

  state.items = state.items.filter(i => i.id !== req.params.id);
  await saveState();
  broadcastState();
  res.json({ ok: true });
});

// Xoá toàn bộ danh sách món (chỉ admin)
app.post('/api/reset', requireAdmin, async (req, res) => {
  state.items = [];
  state.lastSpin = null;
  await saveState();
  broadcastState();
  res.json({ ok: true });
});

// Quay random (chỉ admin)
app.post('/api/spin', requireAdmin, async (req, res) => {
  if (state.items.length < 2) {
    return res.status(400).json({ error: 'Cần ít nhất 2 món để quay.' });
  }
  const winnerIndex = crypto.randomInt(0, state.items.length);
  const winner = state.items[winnerIndex];

  state.spinId += 1;
  state.lastSpin = {
    spinId: state.spinId,
    winnerId: winner.id,
    winnerName: winner.name,
    winnerIndex,
    itemsSnapshot: state.items.slice(),
    timestamp: Date.now()
  };
  state.history.unshift({
    spinId: state.spinId,
    winnerName: winner.name,
    winnerOwnerName: winner.ownerName || null,
    totalItems: state.items.length,
    timestamp: state.lastSpin.timestamp
  });
  if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;

  await saveState();
  broadcastState(); // mọi client (kể cả admin vừa bấm) đều nhận animation quay từ đây
  res.json({ ok: true });
});

// Gửi tin nhắn chat (public - ai có tên cũng gửi được)
app.post('/api/chat', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const ownerId = typeof req.body?.ownerId === 'string' ? req.body.ownerId.trim() : '';

  if (!name) return res.status(400).json({ error: 'Thiếu tên người gửi.' });
  if (!ownerId) return res.status(400).json({ error: 'Thiếu định danh người dùng.' });
  if (!text) return res.status(400).json({ error: 'Tin nhắn không được để trống.' });
  if (text.length > 300) return res.status(400).json({ error: 'Tin nhắn quá dài (tối đa 300 ký tự).' });

  state.chat.push({ id: crypto.randomBytes(6).toString('hex'), name, ownerId, text, timestamp: Date.now() });
  if (state.chat.length > MAX_CHAT) state.chat.shift();
  await saveState();
  broadcastState();
  res.status(201).json({ ok: true });
});

(async () => {
  state = await loadState();
  server.listen(PORT, () => {
    console.log(`Food Wheel server (WebSocket + Upstash Redis) đang chạy tại http://localhost:${PORT}`);
    console.log(`Mật khẩu admin: ${ADMIN_PASSWORD === 'admin123' ? '"admin123" (MẶC ĐỊNH - hãy đổi qua biến môi trường ADMIN_PASSWORD!)' : '(đã đặt qua biến môi trường)'}`);
  });
})();
