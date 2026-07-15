# 🍽️ Vòng Quay Món Ăn — Server

Server Node.js nhỏ gọn để nhiều người cùng vào 1 link, thêm món ăn muốn ăn.
**Chỉ admin (biết mật khẩu) mới có quyền bấm quay random.**

## 1. Chạy thử trên máy của bạn

Cần cài [Node.js](https://nodejs.org) bản 18 trở lên.

```bash
cd food-wheel-server
npm install
ADMIN_PASSWORD="matkhau-cua-ban" npm start
```

Mở trình duyệt vào `http://localhost:3000`.

- **Người bình thường**: chỉ cần mở link, gõ món ăn, bấm "Thêm".
- **Admin**: bấm "Đăng nhập Admin" ở cuối trang, nhập mật khẩu (chính là giá trị `ADMIN_PASSWORD` bạn đặt lúc chạy server) để mở khoá nút "Quay Random", xoá món, và reset danh sách.

⚠️ Nếu không đặt `ADMIN_PASSWORD`, server sẽ dùng mật khẩu mặc định `admin123` — nhớ đổi trước khi gửi link cho người khác.

## 2. Cách hoạt động

- Dữ liệu (danh sách món + kết quả quay gần nhất) được lưu trong file `data.json` ngay trên server, nên **không mất khi tắt/bật lại server**.
- Mọi trình duyệt tự động kiểm tra dữ liệu mới mỗi 2.5 giây, nên khi admin quay, tất cả mọi người đang mở link đều thấy bánh xe tự quay và ra cùng 1 kết quả.
- Quyền admin dựa trên mật khẩu → token lưu trong trình duyệt (12 giờ), không cần tài khoản, không cần database.

## 3. Đưa lên internet để gửi link cho mọi người

Vài lựa chọn deploy miễn phí/dễ dùng nhất cho 1 project Node.js nhỏ như thế này:

### Cách A — Render.com (khuyên dùng, có gói free)
1. Đẩy thư mục `food-wheel-server` này lên 1 repo GitHub.
2. Vào [render.com](https://render.com) → New → Web Service → chọn repo đó.
3. Build command: `npm install`, Start command: `npm start`.
4. Ở phần Environment Variables, thêm `ADMIN_PASSWORD` = mật khẩu bạn muốn.
5. Deploy xong, Render cho bạn 1 link dạng `https://ten-app.onrender.com` — gửi link này cho mọi người.

### Cách B — Railway.app
Tương tự Render: kết nối repo GitHub, thêm biến môi trường `ADMIN_PASSWORD`, deploy, lấy link public.

### Cách C — VPS riêng (DigitalOcean, EC2, v.v.)
```bash
git clone <repo-cua-ban>
cd food-wheel-server
npm install
ADMIN_PASSWORD="matkhau-cua-ban" PORT=3000 npm start
```
Dùng `pm2` để chạy nền lâu dài và tự khởi động lại nếu crash:
```bash
npm install -g pm2
ADMIN_PASSWORD="matkhau-cua-ban" pm2 start server.js --name food-wheel
pm2 save
```
Sau đó cấu hình domain/Nginx trỏ vào cổng server nếu muốn có tên miền đẹp.

## 4. Lưu ý

- Đây là lưu trữ bằng file JSON — phù hợp cho nhóm nhỏ (vài chục người, vài trăm món). Nếu cần dùng quy mô lớn hơn hoặc nhiều phòng/nhóm khác nhau cùng lúc, nên nâng cấp sang một database thật (SQLite/Postgres).
- Đổi mật khẩu admin bất cứ lúc nào bằng cách đổi biến môi trường `ADMIN_PASSWORD` và khởi động lại server.
# food-wheel-server
