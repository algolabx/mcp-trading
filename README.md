# mcp-trading

> **English:** Local MCP server (stdio) for trading Vietnamese stocks on **DNSE, SSI and TCBS** from Claude or any MCP client. Broker API keys stay on your machine (`~/.algolab`, chmod 600) and requests are signed locally from your own IP. 9 tools: `bridge_status`, `get_broker_accounts`, `get_broker_balance`, `get_broker_positions`, `get_broker_orders`, `request_broker_otp`, `submit_broker_otp`, `place_broker_order`, `cancel_broker_order`. Orders are always two-step (preview → explicit confirm). Link a broker with `npx -y github:algolabx/mcp-trading link`, then add `npx -y -p github:algolabx/mcp-trading mcp-trading-server` to your MCP client. For Vietnamese market data (prices, financials, broker research, macro) use the hosted [Algolab MCP](https://mcp.algolab.vn). License: MIT.

MCP server **chạy trên máy bạn** để giao dịch chứng khoán Việt Nam (DNSE · SSI · TCBS) ngay trong Claude Code / Claude Desktop — **khoá API nằm nguyên trên máy bạn**:

- Khoá lưu tại `~/.algolab/mcp-broker.json` (chmod 600) — **không đi qua chat AI, không qua server bên thứ ba**.
- Ký/gọi request local **từ chính IP của bạn** — không cần relay/VPN (DNSE HMAC V2, TCBS JWT, SSI V3 OAuth).
- Phạm vi: **DNSE · SSI · TCBS đều đầy đủ** (đọc + đặt/huỷ lệnh, ký/gửi local). SSI ký lệnh bằng keypair sinh trên máy bạn — dán public key vào iBoard một lần.
- Lệnh tiền luôn 2 bước: AI chỉ nhận bản xem trước, bạn xác nhận rõ ràng thì lệnh mới được gửi.

Không cần tài khoản npm hay GitHub để dùng — cài thẳng từ GitHub bằng `npx`.

## Cách 1 — cài nhanh bằng npx (khuyên dùng)

**Liên kết CTCK** (chạy trong terminal của bạn — KHÔNG dán khoá vào chat AI):

```bash
npx -y github:algolabx/mcp-trading link        # hỏi chọn DNSE / SSI / TCBS rồi nhập khoá
npx -y github:algolabx/mcp-trading link dnse   # API Key + Secret (webtrading DNSE → LightSpeed API) + email OTP
npx -y github:algolabx/mcp-trading link ssi    # ConsumerID + Secret + tiểu khoản; sinh keypair → dán public key iBoard
npx -y github:algolabx/mcp-trading link tcbs   # API Key iFlash (app TCInvest) — tiểu khoản tự phát hiện sau iOTP
npx -y github:algolabx/mcp-trading status      # xem trạng thái (không bao giờ in khoá)
```

**Khai báo với Claude Code** — thêm vào `~/.claude.json`:

```json
{
  "mcpServers": {
    "mcp-trading": {
      "command": "npx",
      "args": ["-y", "-p", "github:algolabx/mcp-trading", "mcp-trading-server"]
    }
  }
}
```

Restart Claude — nhóm tool `bridge_status`, `get_broker_*`, `place_broker_order`… xuất hiện.

## Cách 2 — clone repo

```bash
git clone https://github.com/algolabx/mcp-trading.git && cd mcp-trading && npm install
node src/cli.js link dnse
```

`~/.claude.json`: `{ "command": "node", "args": ["<đường-dẫn>/mcp-trading/src/index.js"] }`.

## Tool

| Tool | Việc | Cần OTP? |
|---|---|---|
| `bridge_status` | Trạng thái liên kết cả 3 CTCK (không bao giờ in khoá) | — |
| `get_broker_accounts / balance / positions / orders` | Đọc tài khoản (tham số `broker`, mặc định dnse) | DNSE: không · SSI: OTP 1 lần rồi tự refresh · TCBS: iOTP/8h |
| `request_broker_otp` / `submit_broker_otp` | Mở phiên theo từng CTCK | — |
| `place_broker_order` / `cancel_broker_order` | Lệnh thật DNSE/TCBS, 2 bước xem trước → `confirm=true` | Có |

## An toàn

- Không có tool nào nhận hay trả khoá — kênh duy nhất đưa khoá vào là CLI trên terminal của bạn.
- Request đi thẳng máy bạn → CTCK qua HTTPS; bridge không gọi về bất kỳ máy chủ nào của Algolab.
- Thu hồi bất kỳ lúc nào: `unlink dnse` (xoá khỏi máy) và/hoặc thu hồi key tại CTCK (chết toàn cục).
- Test: `npm test` (chữ ký HMAC, quyền file 600, chuẩn hoá chiều lệnh).

## Nguồn

Bridge này là Tầng C của thiết kế bảo mật "Két Ba Tầng" của [Algolab](https://algolab.vn) — xem tài liệu tại [mcp.algolab.vn/trading](https://mcp.algolab.vn/trading). MIT License.
