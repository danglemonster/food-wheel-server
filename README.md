# 🍽️ Vòng Quay Món Ăn — Server (WebSocket + Upstash Redis)

Server Node.js để nhiều người cùng vào 1 link, thêm món ăn muốn ăn, chat, xem ai đang online.
**Chỉ admin (biết mật khẩu) mới quay được.** Cập nhật **real-time qua WebSocket** — không cần
tải lại trang, không có độ trễ chờ như trước. Dữ liệu lưu trên **Upstash Redis** (free, không bị
mất khi server restart/deploy lại — khác với việc lưu bằng file, vốn không dùng được trên gói free
của Render vì ổ đĩa ở đó không bền vững).

## 1. Tạo database Upstash Redis (miễn phí, ~2 phút)

1. Vào [console.upstash.com](https://console.upstash.com) → đăng ký (có thể dùng GitHub) → **Create Database**.
2. Đặt tên tuỳ ý, chọn region gần Render nhất (ví dụ Singapore/Tokyo nếu bạn deploy Render ở khu vực đó).
3. Sau khi tạo xong, vào tab **REST API**, copy 2 giá trị:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

Đây là 2 biến môi trường bạn sẽ cần khi chạy server.

## 2. Chạy thử trên máy của bạn

Cần [Node.js](https://nodejs.org) bản 18 trở lên.

```bash
cd food-wheel-server
npm install
ADMIN_PASSWORD="matkhau-cua-ban" \
UPSTASH_REDIS_REST_URL="https://xxxx.upstash.io" \
UPSTASH_REDIS_REST_TOKEN="xxxxxxxx" \
npm start
```

Mở `http://localhost:3000`. Nếu chưa cấu hình 2 biến Upstash, server **vẫn chạy được** (để bạn test
nhanh giao diện) nhưng sẽ in cảnh báo và **không lưu dữ liệu** — mọi thứ mất khi restart.

## 3. Có gì thay đổi so với bản trước?

| | Bản cũ | Bản này |
|---|---|---|
| Cập nhật cho người xem | Polling mỗi 2.5s | **WebSocket đẩy real-time**, gần như tức thời |
| Lưu dữ liệu | File `data.json` trên ổ đĩa server | **Upstash Redis** (REST API, không cần ổ đĩa bền vững) |
| Thành viên online | Suy đoán qua "nhịp tim" polling (TTL 8s) | Biết chính xác qua kết nối WebSocket còn sống hay không |

Về mặt sử dụng, giao diện và tính năng (thêm/xoá món, quay, chat, lịch sử, thông báo tab...)
giữ nguyên như trước — chỉ phần "dưới nắp capo" là real-time và bền vững hơn.

## 4. Đưa lên Render.com (free) để gửi link cho mọi người

1. Đẩy thư mục `food-wheel-server` lên 1 repo GitHub.
2. Vào [render.com](https://render.com) → **New** → **Web Service** → chọn repo đó.
3. Build command: `npm install` — Start command: `npm start`.
4. Ở phần **Environment Variables**, thêm cả 3 biến:
   - `ADMIN_PASSWORD` = mật khẩu bạn muốn
   - `UPSTASH_REDIS_REST_URL` = URL lấy ở bước 1
   - `UPSTASH_REDIS_REST_TOKEN` = token lấy ở bước 1
5. Deploy xong, Render cho bạn 1 link dạng `https://ten-app.onrender.com` — gửi link này cho mọi người.

⚠️ **Lưu ý về gói free của Render**: service sẽ tự "ngủ" sau 15 phút không có ai truy cập, và lần
truy cập tiếp theo sẽ mất khoảng 30–60 giây để "thức dậy" (cold start). Trong lúc đó kết nối
WebSocket sẽ bị rớt — nhưng client đã được viết để **tự động kết nối lại** khi server sẵn sàng trở
lại, không cần người dùng tải lại trang thủ công. Dữ liệu thì luôn an toàn vì đã nằm trên Upstash,
không phụ thuộc vào việc Render service ngủ hay thức.

Nếu không muốn chờ cold start, cân nhắc:
- Dùng dịch vụ "ping định kỳ" để giữ service không ngủ (có nhiều tool miễn phí làm việc này), hoặc
- Nâng cấp lên gói trả phí thấp nhất của Render (không còn bị spin-down).

### Cách khác: Railway.app
Tương tự Render: kết nối repo GitHub, thêm 3 biến môi trường như trên, deploy, lấy link public.
Railway không có spin-down như Render free nên trải nghiệm mượt hơn, nhưng free tier có giới hạn
giờ chạy/tháng thay vì giới hạn theo kiểu ngủ-thức.

## 5. Giới hạn của Upstash free tier

Upstash có gói free khá rộng rãi cho quy mô ứng dụng nhỏ như thế này (vài chục người, vài trăm
món/tin nhắn). Nếu app phát triển lớn hơn (nhiều phòng, nhiều người dùng đồng thời liên tục),
hãy kiểm tra hạn mức mới nhất tại [trang giá của Upstash](https://upstash.com/pricing) trước khi
mở rộng.

## 6. Đổi mật khẩu admin

Đổi biến môi trường `ADMIN_PASSWORD` rồi khởi động lại server (trên Render: vào Environment →
sửa giá trị → service tự deploy lại).
