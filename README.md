# Báo cáo tiến độ Đại lý tiêu chuẩn (ĐLTC) đang thi công

Web app React + Vite, dữ liệu trên **Supabase**, chạy trên **Cloudflare Pages** (toàn bộ gói miễn phí).

- Ai có link đều **xem** và **xuất PDF** được (không cần đăng nhập).
- Chỉ tài khoản do bạn tạo mới **đăng nhập** để thêm / sửa / xóa / tải ảnh (dùng chung cho cả 6 đơn vị).
- Nhiều người sửa cùng lúc: dữ liệu đồng bộ realtime.

## 0. Thông tin Supabase của dự án

| Tên | Giá trị |
|---|---|
| Project URL | `https://igqpwyuvcnkkwelemqde.supabase.co` |
| Publishable key | `sb_publishable_4qgMGvWgvAs2WM5rs3reXQ_M4k0f93M` |

Publishable key (tên cũ: anon key) được thiết kế để nằm trong mã nguồn phía trình duyệt, an toàn khi người xem nhìn thấy; quyền ghi dữ liệu vẫn bị chặn bởi phân quyền (RLS) trong `supabase/schema.sql`. **Không bao giờ** đưa `secret key` / `service_role key` vào code hoặc dán vào chat.

Dùng ở 3 nơi:
- Máy local: file `.env` (đã điền sẵn, không bị đẩy lên GitHub).
- Cloudflare Pages: biến `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` (mục 4).
- GitHub Secrets: `SUPABASE_URL` và `SUPABASE_ANON_KEY` (mục 5).

## 1. Chạy thử trên máy

```bash
npm install
# File .env đã có sẵn thông tin Supabase của dự án (xem mục 0)
npm run dev              # http://localhost:3000
```

Cần Node 22 (`.nvmrc`).

## 2. Thiết lập Supabase (làm 1 lần)

1. Vào https://supabase.com → **New project**. Chọn Region **Singapore**. Đặt mật khẩu database và lưu lại.
2. Mở **SQL Editor** → New query → dán toàn bộ nội dung `supabase/schema.sql` → **Run**. (Chạy lại nhiều lần vẫn an toàn.)
3. **Authentication → Sign In / Providers → Email**:
   - Tắt **Allow new users to sign up** (để không ai tự đăng ký).
   - Tắt **Confirm email**.
4. **Authentication → Users → Add user → Create new user**: nhập email + mật khẩu, tick **Auto Confirm User**. Lặp lại cho từng người được phép sửa.
5. **Kiểm tra lại bước 3**: nếu quên tắt "Allow new users to sign up" thì người lạ có thể tự tạo tài khoản và sửa dữ liệu. Đây là chốt bảo mật quan trọng nhất của hệ thống.
6. Thông tin URL và key đã có ở mục 0 (muốn xem lại: **Project Settings → API**).

## 3. Đưa code lên GitHub

```bash
git init && git add . && git commit -m "init"
git branch -M main
git remote add origin https://github.com/<tai-khoan>/<ten-repo>.git
git push -u origin main
```

File `.env` đã nằm trong `.gitignore`, sẽ không bị đẩy lên.

## 4. Triển khai Cloudflare Pages

1. https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git** → chọn repo.
2. Cấu hình build:
   - Framework preset: **None** (hoặc Vite)
   - Build command: `npm run build`
   - Build output directory: `dist`
3. **Environment variables** (Production):
   - `VITE_SUPABASE_URL` = `https://igqpwyuvcnkkwelemqde.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `sb_publishable_4qgMGvWgvAs2WM5rs3reXQ_M4k0f93M`
   - `NODE_VERSION` = `22`
4. **Save and Deploy**. Link dạng `https://<ten>.pages.dev` là link để mọi người xem.
5. Quay lại Supabase → **Authentication → URL Configuration** → đặt **Site URL** là link Cloudflare ở trên.

Mỗi lần `git push` lên `main`, Cloudflare tự build và cập nhật.

## 5. GitHub Actions (chống Supabase tự tạm dừng + sao lưu)

Gói free của Supabase tự tạm dừng nếu 7 ngày không có truy cập. Repo có sẵn 2 workflow:

- `.github/workflows/keep-alive.yml`: gọi API mỗi 3 ngày để giữ project hoạt động.
- `.github/workflows/backup.yml`: mỗi tuần xuất dữ liệu ra file JSON (lưu 90 ngày ở tab Actions → Artifacts).

Thêm 2 secret tại GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:

- `SUPABASE_URL` = `https://igqpwyuvcnkkwelemqde.supabase.co`
- `SUPABASE_ANON_KEY` = `sb_publishable_4qgMGvWgvAs2WM5rs3reXQ_M4k0f93M`

Nếu project vẫn bị tạm dừng: vào Supabase dashboard → **Restore project**.

Lưu ý: GitHub tự tắt các workflow chạy theo lịch nếu repo công khai (public) không có hoạt động nào trong 60 ngày. Nên để repo ở chế độ **Private**; nếu thấy workflow bị tắt thì vào tab **Actions** bấm **Enable workflow**. (Khi web có người mở xem thường xuyên thì Supabase cũng không bị tạm dừng.)

## 6. Ghi chú sử dụng

- Ảnh tự nén trước khi tải lên (ảnh lớn ≤1600px, ảnh thu nhỏ ≤480px); tối đa 5 ảnh mỗi ĐLTC. PDF dùng ảnh thu nhỏ nên xuất nhanh.
- Kéo thả để đổi thứ tự ảnh chỉ hoạt động trên máy tính (điện thoại chưa hỗ trợ).
- "Số ngày đã làm" luôn được tính từ ngày bắt đầu, không lưu trong database.
- Dữ liệu ban đầu để trống (không chuyển từ bản cũ trên Google AI Studio).
- Giao diện tự thích ứng điện thoại, máy tính bảng, máy tính.

## 7. Giới hạn gói miễn phí cần biết

- Supabase free: database 500 MB, kho ảnh 1 GB (khoảng 3.000 ảnh sau khi nén), 200 người mở web cùng lúc (kết nối realtime).
- Sao lưu hằng tuần chỉ gồm dữ liệu chữ, không gồm file ảnh.
- Nếu 2 người cùng thêm ảnh vào **cùng một ĐLTC trong cùng một giây**, ảnh của một người có thể bị ghi đè (hiếm gặp; thêm lại là được).

## Cấu trúc

```
src/App.tsx            giao diện chính + đồng bộ dữ liệu
src/components/        thẻ ĐLTC, biểu đồ, hộp đăng nhập
src/lib/api.ts         đọc/ghi Supabase + realtime
src/lib/pdfExport.ts   xuất PDF
src/hooks/useAuth.ts   đăng nhập
supabase/schema.sql    bảng, phân quyền, kho ảnh
public/_headers        cấu hình cache cho Cloudflare Pages
```
