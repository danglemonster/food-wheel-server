const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATA_FILE = path.join(__dirname, 'data.json');

// ---- Simple persistence (JSON file) ----
function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      lastSpin: parsed.lastSpin || null,
      spinId: typeof parsed.spinId === 'number' ? parsed.spinId : 0,
      history: Array.isArray(parsed.history) ? parsed.history : [],
      chat: Array.isArray(parsed.chat) ? parsed.chat : [],
      joinedIds: Array.isArray(parsed.joinedIds) ? parsed.joinedIds : []
    };
  } catch (e) {
    return { items: [], lastSpin: null, spinId: 0, history: [], chat: [], joinedIds: [] };
  }
}

let saveTimer = null;
function saveData() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), (err) => {
      if (err) console.error('Lỗi lưu file:', err);
    });
  }, 50); // gộp nhiều lần ghi liên tiếp lại
}

let state = loadData();

// ---- Admin tokens (in-memory) ----
// token -> expiry timestamp
const adminTokens = new Map();
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 giờ

function issueToken() {
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

function isValidToken(token) {
  if (!token) return false;
  const expiry = adminTokens.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    adminTokens.delete(token);
    return false;
  }
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

// clean up expired tokens periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of adminTokens.entries()) {
    if (now > expiry) adminTokens.delete(token);
  }
}, 60 * 60 * 1000);

// ---- App ----
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Đăng nhập admin
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Sai mật khẩu admin.' });
  }
  const token = issueToken();
  res.json({ token });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.slice(7);
  adminTokens.delete(token);
  res.json({ ok: true });
});

// ---- Thành viên đang online (presence, chỉ lưu tạm trong bộ nhớ) ----
const onlineMembers = new Map(); // ownerId -> { name, lastSeen }
const ONLINE_TTL_MS = 8000; // không "ping" trong 8s thì coi như đã rời phòng

function getActiveMembers() {
  const now = Date.now();
  const members = [];
  for (const [ownerId, info] of onlineMembers.entries()) {
    if (now - info.lastSeen <= ONLINE_TTL_MS) {
      members.push({ ownerId, name: info.name });
    } else {
      onlineMembers.delete(ownerId);
    }
  }
  members.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  return members;
}

// Lấy trạng thái hiện tại (public) - ai cũng xem được, không lộ token
// Đồng thời dùng làm "heartbeat": nếu có ownerId + name kèm theo thì ghi nhận đang online
app.get('/api/state', (req, res) => {
  const ownerId = typeof req.query.ownerId === 'string' ? req.query.ownerId.trim() : '';
  const name = typeof req.query.name === 'string' ? req.query.name.trim().slice(0, 30) : '';
  if (ownerId && name) {
    onlineMembers.set(ownerId, { name, lastSeen: Date.now() });
  }

  res.json({
    items: state.items,
    lastSpin: state.lastSpin,
    spinId: state.spinId,
    history: state.history,
    chat: state.chat,
    members: getActiveMembers()
  });
});

const MAX_CHAT = 200;

// Gửi tin nhắn chat (public - ai có tên cũng gửi được)
app.post('/api/chat', (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const ownerId = typeof req.body?.ownerId === 'string' ? req.body.ownerId.trim() : '';

  if (!name) return res.status(400).json({ error: 'Thiếu tên người gửi.' });
  if (!ownerId) return res.status(400).json({ error: 'Thiếu định danh người dùng.' });
  if (!text) return res.status(400).json({ error: 'Tin nhắn không được để trống.' });
  if (text.length > 300) return res.status(400).json({ error: 'Tin nhắn quá dài (tối đa 300 ký tự).' });

  state.chat.push({
    id: crypto.randomBytes(6).toString('hex'),
    name,
    ownerId,
    text,
    timestamp: Date.now()
  });
  if (state.chat.length > MAX_CHAT) state.chat.shift();

  saveData();
  res.status(201).json({ chat: state.chat });
});

// Thông báo có người mới tham gia (chỉ thông báo 1 lần / mỗi người, hiện dạng tin nhắn hệ thống trong chatbox)
app.post('/api/join', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const ownerId = typeof req.body?.ownerId === 'string' ? req.body.ownerId.trim() : '';

  if (!name) return res.status(400).json({ error: 'Thiếu tên người dùng.' });
  if (!ownerId) return res.status(400).json({ error: 'Thiếu định danh người dùng.' });

  if (!state.joinedIds.includes(ownerId)) {
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
    saveData();
  }

  res.json({ chat: state.chat });
});

// Thêm món (public - ai cũng thêm được, nhưng phải có tên + mã định danh trình duyệt)
app.post('/api/items', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const ownerName = typeof req.body?.ownerName === 'string' ? req.body.ownerName.trim() : '';
  const ownerId = typeof req.body?.ownerId === 'string' ? req.body.ownerId.trim() : '';

  if (!ownerName) return res.status(400).json({ error: 'Thiếu tên người thêm món.' });
  if (!ownerId) return res.status(400).json({ error: 'Thiếu định danh người dùng.' });
  if (ownerName.length > 30) return res.status(400).json({ error: 'Tên quá dài (tối đa 30 ký tự).' });
  if (!name) return res.status(400).json({ error: 'Tên món không được để trống.' });
  if (name.length > 60) return res.status(400).json({ error: 'Tên món quá dài.' });
  if (state.items.length >= 200) return res.status(400).json({ error: 'Danh sách đã đầy (tối đa 200 món).' });

  const item = { id: crypto.randomBytes(6).toString('hex'), name, ownerId, ownerName };
  state.items.push(item);
  saveData();
  res.status(201).json({ items: state.items });
});

// Xoá 1 món - chủ món đó (đúng ownerId) hoặc admin mới được xoá
app.delete('/api/items/:id', (req, res) => {
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
  saveData();
  res.json({ items: state.items });
});

// Xoá toàn bộ danh sách (chỉ admin) - có thể giữ hoặc xoá luôn lịch sử quay
app.post('/api/reset', requireAdmin, (req, res) => {
  state.items = [];
  state.lastSpin = null;
  if (req.body && req.body.clearHistory) {
    state.history = [];
  }
  saveData();
  res.json({ items: state.items, lastSpin: state.lastSpin, history: state.history });
});

const MAX_HISTORY = 50;

// Quay random (chỉ admin)
app.post('/api/spin', requireAdmin, (req, res) => {
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
    itemsSnapshot: state.items.slice(), // đảm bảo mọi người quay ra đúng cùng 1 kết quả trên cùng 1 bánh xe
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

  saveData();
  res.json({ lastSpin: state.lastSpin, spinId: state.spinId, history: state.history });
});

app.listen(PORT, () => {
  console.log(`Food Wheel server đang chạy tại http://localhost:${PORT}`);
  console.log(`Mật khẩu admin hiện tại: ${ADMIN_PASSWORD === 'admin123' ? '"admin123" (MẶC ĐỊNH - hãy đổi qua biến môi trường ADMIN_PASSWORD!)' : '(đã đặt qua biến môi trường)'}`);
});
