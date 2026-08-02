# BỘ TEST CASE TIÊU CHUẨN: XÁC THỰC, PHÂN QUYỀN & QUẢN LÝ PROFILE
**Dự án:** GPTResident - Backend (`interview-prep-backend`)  
**Phân hệ:** Xác thực (Auth), Phân quyền (RBAC) & Quản lý Profile  
**Mã User Story liên quan:** `US-001` (Xác thực & Phân quyền), `US-002` (Quản lý Hồ sơ)  
**Phiên bản:** 1.0  
**Ngày cập nhật:** 02/08/2026  

---

## I. TỔNG QUAN MA TRẬN TEST CASE (TEST COVERAGE MATRIX)

| Phân nhóm Tính năng | Tổng số Test Cases | P0 (Critical) | P1 (High) | P2 (Medium) |
| :--- | :---: | :---: | :---: | :---: |
| **1. Đăng ký Tài khoản (Register)** | 6 | 4 | 2 | 0 |
| **2. Đăng nhập Local (Login)** | 6 | 4 | 2 | 0 |
| **3. Đăng nhập Google OAuth2** | 5 | 3 | 2 | 0 |
| **4. Xác thực & Phân quyền JWT (AuthGuard & RBAC)** | 7 | 5 | 2 | 0 |
| **5. Xem & Cập nhật Profile (Get/Patch Profile)** | 6 | 3 | 3 | 0 |
| **6. Upload Ảnh đại diện (Upload Picture)** | 5 | 2 | 2 | 1 |
| **7. Bảo mật & Trường hợp Biên (Security & Edge Cases)** | 5 | 3 | 2 | 0 |
| **TỔNG CỘNG** | **40** | **24** | **15** | **1** |

---

## II. CHI TIẾT DANH SÁCH TEST CASE

### 1. Đăng ký Tài khoản (`POST /auth/register`)

| Test Case ID | Tên Kịch bản Test | Điều kiện tiên quyết | Các bước thực hiện | Dữ liệu đầu vào (Payload) | Kết quả kỳ vọng | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **TC-REG-001** | Đăng ký tài khoản Local thành công với dữ liệu hợp lệ | Email chưa tồn tại trong CSDL | 1. Gửi request `POST /auth/register`<br>2. Kiểm tra CSDL `users` | `{"email": "user1@example.com", "password": "Password123!", "name": "Nguyen Van A"}` | **201 Created**<br>`{"message": "User registered successfully"}`<br>Mật khẩu được mã hóa bcrypt trong DB. | **P0** |
| **TC-REG-002** | Đăng ký thất bại khi Email đã tồn tại | Email `user1@example.com` đã đăng ký từ trước | 1. Gửi request `POST /auth/register` với email đã có | `{"email": "user1@example.com", "password": "Password123!", "name": "User Duplicate"}` | **400 Bad Request**<br>`{"statusCode": 400, "message": "Email is already registered"}` | **P0** |
| **TC-REG-003** | Đăng ký thất bại khi thiếu trường Email | Không có | 1. Gửi request thiếu key `email` | `{"password": "Password123!", "name": "Nguyen Van B"}` | **400 Bad Request**<br>Validation error yêu cầu nhập email. | **P0** |
| **TC-REG-004** | Đăng ký thất bại khi Định dạng Email không hợp lệ | Không có | 1. Gửi request với email sai cấu trúc | `{"email": "invalid-email-format", "password": "Password123!"}` | **400 Bad Request**<br>Email không đúng định dạng. | **P1** |
| **TC-REG-005** | Đăng ký thành công với vai trò tùy chọn (RECRUITER / ADMIN) | Email mới | 1. Gửi request chọn `role`: `RECRUITER` | `{"email": "recruiter@company.com", "password": "Password123!", "role": "RECRUITER"}` | **201 Created**<br>User được lưu với `role = RECRUITER`. | **P1** |
| **TC-REG-006** | Tự động gán mặc định `name = User` và `role = CANDIDATE` nếu bỏ trống | Email mới | 1. Gửi request chỉ có `email` và `password` | `{"email": "candidate_default@example.com", "password": "Password123!"}` | **201 Created**<br>Field `name` tự gán `User`, `role` tự gán `CANDIDATE`. | **P1** |

---

### 2. Đăng nhập Local (`POST /auth/login`)

| Test Case ID | Tên Kịch bản Test | Điều kiện tiên quyết | Các bước thực hiện | Dữ liệu đầu vào (Payload) | Kết quả kỳ vọng | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **TC-LOG-001** | Đăng nhập thành công với Email & Password đúng | Tài khoản `user1@example.com` đã đăng ký | 1. Gửi request `POST /auth/login`<br>2. Parse JWT Token | `{"email": "user1@example.com", "password": "Password123!"}` | **200 OK**<br>Trả về `access_token` hợp lệ chứa `sub`, `email`, `role` và thông tin `user`. | **P0** |
| **TC-LOG-002** | Đăng nhập thất bại khi sai Mật khẩu | Tài khoản tồn tại | 1. Gửi request với mật khẩu sai | `{"email": "user1@example.com", "password": "WrongPassword123"}` | **401 Unauthorized**<br>`{"statusCode": 401, "message": "Invalid credentials"}` | **P0** |
| **TC-LOG-003** | Đăng nhập thất bại khi Email không tồn tại trong hệ thống | Email chưa đăng ký | 1. Gửi request với email lạ | `{"email": "notfound@example.com", "password": "Password123!"}` | **401 Unauthorized**<br>`{"statusCode": 401, "message": "Invalid credentials"}` | **P0** |
| **TC-LOG-004** | Đăng nhập thất bại khi thiếu Mật khẩu | Tài khoản `local` | 1. Gửi request chỉ có email | `{"email": "user1@example.com"}` | **401 Unauthorized**<br>`{"statusCode": 401, "message": "Password is required"}` | **P0** |
| **TC-LOG-005** | Đăng nhập thất bại khi Email bị bỏ trống | Không có | 1. Gửi request với email rỗng | `{"email": "", "password": "Password123!"}` | **401 Unauthorized** hoặc **400 Bad Request**. | **P1** |
| **TC-REG-LOG-06** | Mật khẩu được mã hóa an toàn bằng bcrypt (Salt cost = 10) | Không có | 1. Đăng ký user<br>2. Kiểm tra chuỗi hash trong DB | - | Trực tiếp kiểm tra DB: Chuỗi hash bắt đầu bằng `$2b$10$...`, mật khẩu gốc không xuất hiện trong log/DB. | **P1** |

---

### 3. Đăng nhập Google OAuth2 (`POST /auth/google`)

| Test Case ID | Tên Kịch bản Test | Điều kiện tiên quyết | Các bước thực hiện | Dữ liệu đầu vào (Payload) | Kết quả kỳ vọng | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **TC-GGL-001** | Đăng nhập Google thành công với Google User mới (Tự động tạo tài khoản) | Google Access Token hợp lệ, email chưa có trong DB | 1. Gửi request `POST /auth/google` | `{"accessToken": "valid_google_access_token"}` | **200 OK**<br>Tự động tạo user mới với `provider = google`, trả về `access_token` JWT. | **P0** |
| **TC-GGL-002** | Đăng nhập Google thành công với Google User đã tồn tại | User Google đã có trong DB | 1. Gửi request `POST /auth/google` | `{"accessToken": "valid_google_access_token"}` | **200 OK**<br>Tự động lấy user hiện tại và trả về JWT `access_token`. | **P0** |
| **TC-GGL-003** | Đăng nhập Google thất bại khi Google Access Token hết hạn hoặc sai | Token hết hạn / Giả mạo | 1. Gửi request với token sai | `{"accessToken": "invalid_or_expired_google_token"}` | **401 Unauthorized**<br>`{"statusCode": 401, "message": "Invalid Google token"}` | **P0** |
| **TC-GGL-004** | Đăng nhập Google thất bại khi Google Profile không trả về email | Tài khoản Google bị ẩn email | 1. Mock Google API trả thông tin thiếu email | `{"accessToken": "no_email_google_token"}` | **400 Bad Request** hoặc **401 Unauthorized** thông báo thiếu Email. | **P1** |
| **TC-GGL-005** | Đăng nhập Google thất bại khi Payload không có `accessToken` | Không có | 1. Gửi body rỗng | `{}` | **401 Unauthorized**<br>Báo lỗi Invalid Google token. | **P1** |

---

### 4. Xác thực & Phân quyền JWT AuthGuard (`AuthGuard` & RBAC)

| Test Case ID | Tên Kịch bản Test | Điều kiện tiên quyết | Các bước thực hiện | Dữ liệu đầu vào (Header) | Kết quả kỳ vọng | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **TC-GRD-001** | Truy cập thành công API được bảo vệ (`GET /user/profile`) khi có Bearer Token hợp lệ | User đã đăng nhập | 1. Lấy `access_token`<br>2. Gọi `GET /user/profile` | `Authorization: Bearer <valid_jwt_token>` | **200 OK**<br>Trả về đúng thông tin Profile của User tương ứng `sub` và `email`. | **P0** |
| **TC-GRD-002** | Từ chối truy cập khi không gửi Authorization Header | Không có Header | 1. Gọi `GET /user/profile` | (Không truyền Header Authorization) | **401 Unauthorized** | **P0** |
| **TC-GRD-003** | Từ chối truy cập khi Scheme không phải là `Bearer` | Token hợp lệ | 1. Gọi API với scheme `Basic` | `Authorization: Basic <valid_jwt_token>` | **401 Unauthorized** | **P0** |
| **TC-GRD-004** | Từ chối truy cập khi JWT Token bị hết hạn (Expired Token) | Token đã hết hạn | 1. Gọi API với token đã quá hạn | `Authorization: Bearer <expired_jwt_token>` | **401 Unauthorized** | **P0** |
| **TC-GRD-005** | Từ chối truy cập khi JWT Token bị chỉnh sửa chữ ký (Tampered Token) | Token bị sửa payload | 1. Sửa payload JWT | `Authorization: Bearer <tampered_jwt_token>` | **401 Unauthorized** | **P0** |
| **TC-GRD-006** | Middleware tự động trích xuất `request.user` chứa `sub`, `email`, `role` chính xác | Token hợp lệ | 1. Gửi request qua `JwtAuthGuard` | `Authorization: Bearer <valid_jwt_token>` | Request context nhận đúng object `user` từ JWT Payload. | **P1** |
| **TC-GRD-007** | Phân quyền RBAC: Candidate không được truy cập Endpoint Admin (`/admin/*`) | User có `role = CANDIDATE` | 1. Gọi API admin với token Candidate | `Authorization: Bearer <candidate_token>` | **403 Forbidden**<br>Access denied for role CANDIDATE. | **P1** |

---

### 5. Quản lý Hồ sơ Ứng viên (`GET` & `PATCH /user/profile`)

| Test Case ID | Tên Kịch bản Test | Điều kiện tiên quyết | Các bước thực hiện | Dữ liệu đầu vào | Kết quả kỳ vọng | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **TC-PRF-001** | Lấy thông tin Profile cá nhân thành công (`GET /user/profile`) | Đã đăng nhập | 1. Gửi `GET /user/profile` với Token hợp lệ | Header `Authorization: Bearer <token>` | **200 OK**<br>Trả về `{ "id": "...", "email": "...", "name": "...", "dob": "...", "role": "..." }` | **P0** |
| **TC-PRF-002** | Cập nhật Profile thành công (`PATCH /user/profile`) | Đã đăng nhập | 1. Gửi `PATCH /user/profile` cập nhật `name` và `dob` | `{"name": "Nguyen Van A Updated", "dob": "1998-10-15"}` | **200 OK**<br>Hệ thống cập nhật DB và trả về profile mới. | **P0** |
| **TC-PRF-003** | Lấy Profile thất bại nếu User bị xóa khỏi CSDL | Token của user đã bị xóa | 1. Gọi `GET /user/profile` | Header `Authorization: Bearer <token>` | **404 Not Found** hoặc **401 Unauthorized**. | **P1** |
| **TC-PRF-004** | Cập nhật Profile với body rỗng | Đã đăng nhập | 1. Gửi `PATCH /user/profile` | `{}` | **200 OK**<br>Không làm thay đổi thông tin hiện tại của User. | **P1** |
| **TC-PRF-005** | Ngăn chặn User tự sửa trường `role` hoặc `id` thông qua `PATCH /user/profile` | User bình thường | 1. Gửi `PATCH /user/profile` chứa `role: "ADMIN"` | `{"name": "Hack Role", "role": "ADMIN"}` | **200 OK**<br>Trường `role` bị loại bỏ/bỏ qua, giữ nguyên `role = CANDIDATE`. | **P0** |
| **TC-PRF-006** | Cập nhật Profile với ký tự tiếng Việt có dấu và Unicode | Đã đăng nhập | 1. Gửi `PATCH /user/profile` với tên chứa tiếng Việt | `{"name": "Lê Nguyễn Phi Trường"}` | **200 OK**<br>Tên tiếng Việt hiển thị chính xác utf-8. | **P1** |

---

### 6. Upload Ảnh đại diện (`POST /user/profile/picture`)

| Test Case ID | Tên Kịch bản Test | Điều kiện tiên quyết | Các bước thực hiện | Dữ liệu đầu vào (Multipart) | Kết quả kỳ vọng | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **TC-PIC-001** | Upload ảnh đại diện thành công (File PNG/JPEG <= 5MB) | Đã đăng nhập | 1. Chọn file `avatar.png` (2MB)<br>2. Gửi `POST /user/profile/picture` | Form-data: `file` / `picture` = `avatar.png` | **200 OK** / **201 Created**<br>Trả về URL ảnh `pictureUrl`, cập nhật profile. | **P0** |
| **TC-PIC-002** | Upload ảnh thất bại khi Dung lượng file vượt quá 5MB (> 5 * 1024 * 1024 bytes) | Đã đăng nhập | 1. Chọn file `large_image.jpg` (6.5MB)<br>2. Gửi request | Form-data: `file` = `large_image.jpg` (6.5MB) | **400 Bad Request** / **413 Payload Too Large**<br>Báo lỗi file vượt quá giới hạn 5MB. | **P0** |
| **TC-PIC-003** | Upload ảnh thất bại khi Định dạng file không phải là ảnh (e.g. `.exe`, `.pdf`, `.txt`) | Đã đăng nhập | 1. Chọn file `script.sh` hoặc `document.pdf`<br>2. Gửi request | Form-data: `file` = `document.pdf` | **400 Bad Request**<br>Báo lỗi file type không hỗ trợ (chỉ nhận JPG/PNG/WEBP/GIF). | **P1** |
| **TC-PIC-004** | Upload ảnh thất bại khi không truyền file (Form-data rỗng) | Đã đăng nhập | 1. Gửi request multipart không chọn file | Form-data: (Empty) | **400 Bad Request**<br>Báo lỗi thiếu file upload. | **P1** |
| **TC-PIC-005** | Hỗ trợ cả 2 tên field Upload: `file` hoặc `picture` | Đã đăng nhập | 1. Thử gửi field `picture`<br>2. Thử gửi field `file` | Form-data `picture` / `file` | **200 OK**<br>Cả 2 tên field đều được Interceptor xử lý thành công. | **P2** |

---

### 7. Bảo mật & Trường hợp Biên (Security & Edge Cases)

| Test Case ID | Tên Kịch bản Test | Điều kiện tiên quyết | Các bước thực hiện | Dữ liệu đầu vào | Kết quả kỳ vọng | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **TC-SEC-001** | Kiểm tra chống SQL / NoSQL / Command Injection trong trường Email & Password | Không có | 1. Gửi email chứa payload injection: `' OR '1'='1` | `{"email": "' OR '1'='1 --", "password": "password"}` | **400 Bad Request** hoặc **401 Unauthorized**. Không làm lọt thông tin hoặc crash DB. | **P0** |
| **TC-SEC-002** | Kiểm tra chống XSS trong trường `name` khi cập nhật Profile | Đã đăng nhập | 1. Gửi name chứa mã script `<script>alert('xss')</script>` | `{"name": "<script>alert('xss')</script>"}` | Ký tự HTML/Script được encode an toàn khi lưu/trả về, không thực thi script. | **P0** |
| **TC-SEC-003** | Kiểm tra xử lý đồng thời (Concurrent Request) khi 2 request đăng ký cùng 1 Email | CSDL rỗng | 1. Gửi đồng thời 2 request register cùng email | 2 x Request `POST /auth/register` | 1 Request thành công **201**, 1 Request thất bại **400 Bad Request** (Unique constraint). | **P0** |
| **TC-SEC-004** | Lỗi kết nối CSDL / AWS DynamoDB khi xác thực | CSDL ngắt kết nối | 1. Mock CSDL sập<br>2. Gọi API login | `{"email": "user1@example.com", "password": "Password123!"}` | **500 Internal Server Error**<br>Hệ thống không lộ thông tin chuỗi nới CSDL/Secret Key. | **P1** |
| **TC-SEC-005** | Đảm bảo Secret Key JWT không bị hardcode trong source code sản phẩm | Không có | 1. Kiếm tra file `jwt-auth.guard.ts` và `.env` | Inspect `process.env.JWT_SECRET` | Mã nguồn sử dụng `process.env.JWT_SECRET`, báo cảnh báo nếu dùng fallback key ở production. | **P1** |

---

## III. HƯỚNG DẪN CHẠY TEST TỰ ĐỘNG (AUTOMATED TEST EXECUTION)

### 1. Chạy Unit Tests với Jest
Các file Unit Test đã được khởi tạo sẵn trong codebase:
* [auth.service.spec.ts](file:///d:/NCKH/interview-prep-backend/src/modules/auth/auth.service.spec.ts)
* [jwt-auth.guard.spec.ts](file:///d:/NCKH/interview-prep-backend/src/common/guards/jwt-auth.guard.spec.ts)
* [user.service.spec.ts](file:///d:/NCKH/interview-prep-backend/src/modules/user/user.service.spec.ts)

Để thực thi bộ Unit Test tự động, chạy lệnh terminal sau:
```bash
cd d:\NCKH\interview-prep-backend
npx jest src/modules/auth/auth.service.spec.ts src/common/guards/jwt-auth.guard.spec.ts src/modules/user/user.service.spec.ts
```

### 2. Kiểm tra độ bao phủ mã nguồn (Code Coverage Report)
```bash
npx jest --coverage
```

---
**Tài liệu lưu trữ tại:** [TEST_CASES_AUTH_PROFILE.md](file:///d:/NCKH/interview-prep-backend/docs/TEST_CASES_AUTH_PROFILE.md)
