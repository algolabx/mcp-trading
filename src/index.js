#!/usr/bin/env node
// mcp-trading — local MCP bridge (stdio), Tầng C của thiết kế
// "Két Ba Tầng" (.docs/broker-credential-security.md):
//   • Khoá API CTCK nằm NGUYÊN trên máy user (~/.algolab, chmod 600) —
//     KHÔNG có tool nào nhận/trả khoá; setup duy nhất qua CLI ngoài chat.
//   • Ký/gọi local từ IP của chính user (giải geo-block DNSE, không relay).
//   • Lệnh tiền giữ nghi thức 2 bước: preview (không mạng) → confirm=true.
// Phạm vi: DNSE · SSI · TCBS đều ĐẦY ĐỦ (đọc + đặt/huỷ lệnh), ký/gửi local.
// SSI ký lệnh bằng keypair RSA sinh trên máy user; user dán public key vào
// iBoard một lần (Dịch vụ API) — private key không rời máy.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, saveConfig, tradingTokenValid, NOT_LINKED_MSG } from "./config.js";
import * as dnse from "./dnse.js";
import * as ssi from "./ssi.js";
import * as tcbs from "./tcbs.js";

const server = new McpServer({ name: "mcp-trading", version: "0.3.0" });

const j = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 1) }] });

const safe = (fn) => async (args) => {
  try {
    return await fn(args ?? {});
  } catch (e) {
    const brokerErr = ["DnseError", "SsiError", "TcbsError"].includes(e.name);
    return j({
      error: brokerErr ? "BROKER_ERROR" : "BRIDGE_ERROR",
      message: e.message,
      ...(e.detail ? { detail: e.detail } : {}),
    });
  }
};

const BROKER = z.enum(["dnse", "ssi", "tcbs"]).default("dnse");

const linkHint = (name) =>
  `Chưa liên kết ${name.toUpperCase()} trên máy này. Chạy trong terminal (KHÔNG dán khoá vào chat):\n` +
  `  npx mcp-trading link ${name}\n` +
  `Khoá lưu tại ~/.algolab/mcp-broker.json quyền 600 và không rời máy bạn.`;

function need(cfg, name) {
  if (!cfg[name]) {
    const err = new Error(name === "dnse" ? NOT_LINKED_MSG : linkHint(name));
    err.name = "BRIDGE_ERROR";
    throw err;
  }
  return cfg[name];
}

/** SSI: access token tươi (tự refresh); hết cả refresh → chỉ đường OTP. */
async function ssiToken(cfg) {
  const s = need(cfg, "ssi");
  const token = await ssi.freshAccessToken(s, async () => saveConfig(cfg));
  if (!token) {
    const err = new Error(
      "Token SSI hết hạn (cả refresh) — gọi request_broker_otp(broker=\"ssi\") rồi submit_broker_otp với mã.",
    );
    err.name = "BRIDGE_ERROR";
    throw err;
  }
  return token;
}

function tcbsJwt(cfg) {
  const t = need(cfg, "tcbs");
  if (!tcbs.jwtValid(t)) {
    const err = new Error(
      'Phiên TCBS (JWT 8h) hết/chưa mở — lấy mã iOTP trong app TCInvest rồi gọi submit_broker_otp(broker="tcbs", otp=…).',
    );
    err.name = "BRIDGE_ERROR";
    throw err;
  }
  return t.jwt.value;
}

function pickAccount(cfgSection, account, label) {
  const acc = account || cfgSection.defaultAccount;
  if (!acc) throw new Error(`Thiếu account và chưa có tiểu khoản mặc định ${label}.`);
  return acc;
}

// ── trạng thái ──────────────────────────────────────────────────────────────

server.tool(
  "bridge_status",
  "Trạng thái bridge local: CTCK nào đã liên kết trên máy này, phiên nào còn hạn. " +
    "Khoá KHÔNG bao giờ hiển thị; liên kết/thu hồi chỉ qua CLI `mcp-trading` trong terminal.",
  {},
  safe(async () => {
    const cfg = loadConfig();
    return j({
      dnse: cfg.dnse
        ? { linked: true, default_account: cfg.dnse.defaultAccount ?? null, trading_token_valid: tradingTokenValid(cfg) }
        : { linked: false, how_to_link: linkHint("dnse") },
      ssi: cfg.ssi
        ? {
            linked: true,
            default_account: cfg.ssi.defaultAccount ?? null,
            token: cfg.ssi.tokens?.accessToken ? "có (tự refresh)" : "chưa mở — cần OTP một lần",
            keypair: cfg.ssi.privateKeyPem ? "có (đặt lệnh được sau khi dán public key iBoard)" : "chưa có — chạy link ssi",
          }
        : { linked: false, how_to_link: linkHint("ssi") },
      tcbs: cfg.tcbs
        ? { linked: true, default_account: cfg.tcbs.defaultAccount ?? null, jwt_valid: tcbs.jwtValid(cfg.tcbs) }
        : { linked: false, how_to_link: linkHint("tcbs") },
      note: "Bridge chạy trên máy user — khoá không rời máy, request đi thẳng IP của user tới CTCK.",
    });
  }),
);

// ── đọc tài khoản ───────────────────────────────────────────────────────────

server.tool(
  "get_broker_accounts",
  "Danh sách tiểu khoản tại một CTCK (gọi thẳng từ máy user).",
  { broker: BROKER.optional() },
  safe(async ({ broker = "dnse" }) => {
    const cfg = loadConfig();
    if (broker === "dnse") {
      const d = need(cfg, "dnse");
      return j({ accounts: await dnse.getAccounts(d), default_account: d.defaultAccount ?? null });
    }
    if (broker === "ssi") {
      const s = need(cfg, "ssi");
      const token = await ssiToken(cfg);
      return j({ accounts: await ssi.getAccountInfo(token), default_account: s.defaultAccount ?? null });
    }
    const t = need(cfg, "tcbs");
    const jwt = tcbsJwt(cfg);
    const claims = tcbs.decodeJwtClaims(jwt);
    const custody = t.custodyCode ?? tcbs.findCustodyCode(claims);
    const profile = custody ? await tcbs.getProfile(jwt, custody) : null;
    return j({
      accounts: profile?.bankSubAccounts ?? [],
      custody_code: custody,
      default_account: t.defaultAccount ?? null,
    });
  }),
);

server.tool(
  "get_broker_balance",
  "Tiền mặt / sức mua của một tiểu khoản.",
  { broker: BROKER.optional(), account: z.string().optional() },
  safe(async ({ broker = "dnse", account }) => {
    const cfg = loadConfig();
    if (broker === "dnse") {
      const d = need(cfg, "dnse");
      return j({ balance: await dnse.getBalances(d, pickAccount(d, account, "DNSE")) });
    }
    if (broker === "ssi") {
      const s = need(cfg, "ssi");
      const token = await ssiToken(cfg);
      return j({ balance: await ssi.getBalance(token, pickAccount(s, account, "SSI"), s.consumerId) });
    }
    const t = need(cfg, "tcbs");
    const jwt = tcbsJwt(cfg);
    const acc = pickAccount(t, account, "TCBS");
    const [cash, asset] = await Promise.all([tcbs.getStockCash(jwt, acc), tcbs.getStockAsset(jwt, acc)]);
    return j({ cash, asset });
  }),
);

server.tool(
  "get_broker_positions",
  "Danh mục đang nắm giữ của một tiểu khoản.",
  {
    broker: BROKER.optional(),
    account: z.string().optional(),
    market: z.enum(["STOCK", "DERIVATIVE"]).default("STOCK").optional(),
  },
  safe(async ({ broker = "dnse", account, market }) => {
    const cfg = loadConfig();
    if (broker === "dnse") {
      const d = need(cfg, "dnse");
      return j({ positions: await dnse.getPositions(d, pickAccount(d, account, "DNSE"), market ?? "STOCK") });
    }
    if (broker === "ssi") {
      const s = need(cfg, "ssi");
      const token = await ssiToken(cfg);
      return j({ positions: await ssi.getPositions(token, pickAccount(s, account, "SSI"), s.consumerId) });
    }
    const t = need(cfg, "tcbs");
    return j({ asset: await tcbs.getStockAsset(tcbsJwt(cfg), pickAccount(t, account, "TCBS")) });
  }),
);

server.tool(
  "get_broker_orders",
  "Sổ lệnh trong ngày của một tiểu khoản.",
  {
    broker: BROKER.optional(),
    account: z.string().optional(),
    market: z.enum(["STOCK", "DERIVATIVE"]).default("STOCK").optional(),
  },
  safe(async ({ broker = "dnse", account, market }) => {
    const cfg = loadConfig();
    if (broker === "dnse") {
      const d = need(cfg, "dnse");
      return j({ orders: await dnse.getOrders(d, pickAccount(d, account, "DNSE"), market ?? "STOCK") });
    }
    if (broker === "ssi") {
      const s = need(cfg, "ssi");
      const token = await ssiToken(cfg);
      return j({ orders: await ssi.getOrderBook(token, pickAccount(s, account, "SSI")) });
    }
    const t = need(cfg, "tcbs");
    return j({ orders: await tcbs.getStockOrderBook(tcbsJwt(cfg), pickAccount(t, account, "TCBS")) });
  }),
);

// ── OTP / mở phiên ──────────────────────────────────────────────────────────

server.tool(
  "request_broker_otp",
  "Nhờ CTCK gửi OTP mở phiên. DNSE: OTP email (chỉ cần cho đặt/huỷ lệnh; có Smart OTP thì bỏ qua). " +
    "SSI: gửi theo 2FA đã đăng ký — cần một lần cho cả đọc, sau đó refresh tự gia hạn. " +
    "TCBS: không gửi gì — iOTP sinh trong app TCInvest, nộp thẳng submit_broker_otp.",
  { broker: BROKER.optional(), email: z.string().optional() },
  safe(async ({ broker = "dnse", email }) => {
    const cfg = loadConfig();
    if (broker === "dnse") {
      const d = need(cfg, "dnse");
      const to = email || d.email;
      if (!to) throw new Error("Chưa có email nhận OTP — truyền email, hoặc dùng smart_otp qua submit_broker_otp.");
      await dnse.sendEmailOtp(d, to);
      return j({ sent: true, message: `DNSE đã gửi OTP về ${to}. Gọi submit_broker_otp với mã nhận được.` });
    }
    if (broker === "ssi") {
      const s = need(cfg, "ssi");
      const r = await ssi.requestOtp(s.consumerId, s.consumerSecret);
      return j({
        sent: true,
        transaction_id: r?.transactionId ?? null,
        message: "SSI đã gửi OTP (SMS/email) hoặc đẩy Smart OTP — gọi submit_broker_otp với mã (hoặc transaction_id sau khi duyệt app).",
      });
    }
    need(cfg, "tcbs");
    return j({ sent: false, message: "TCBS dùng iOTP sinh trong app TCInvest — mở app lấy mã rồi gọi submit_broker_otp." });
  }),
);

server.tool(
  "submit_broker_otp",
  "Nộp OTP mở phiên. DNSE: trading token 8h (smart_otp=true nếu mã từ app). " +
    "SSI: mở access+refresh token (đọc dùng được ngay, tự gia hạn). TCBS: JWT 8h + bridge tự phát hiện tiểu khoản.",
  {
    broker: BROKER.optional(),
    otp: z.string().optional(),
    smart_otp: z.boolean().default(false).optional(),
    transaction_id: z.string().optional(),
  },
  safe(async ({ broker = "dnse", otp, smart_otp, transaction_id }) => {
    const cfg = loadConfig();
    if (broker === "dnse") {
      const d = need(cfg, "dnse");
      if (!otp) throw new Error("Thiếu otp.");
      const token = await dnse.createTradingToken(d, smart_otp ? "smart_otp" : "email_otp", otp);
      d.tradingToken = { value: token, expiresAt: new Date(Date.now() + 8 * 3600_000).toISOString() };
      saveConfig(cfg);
      return j({ trading_token_valid: true, message: "Đã mở khoá đặt lệnh DNSE (trading token 8h, lưu local)." });
    }
    if (broker === "ssi") {
      const s = need(cfg, "ssi");
      if (!otp && !transaction_id) throw new Error("Thiếu otp (hoặc transaction_id với Smart OTP push).");
      const token = await ssi.getToken(s.consumerId, s.consumerSecret, otp, transaction_id);
      if (!token.accessToken) throw new Error("SSI không trả access token.");
      s.tokens = ssi.tokensFromResponse(token);
      saveConfig(cfg);
      return j({ unlocked: true, message: "Đã mở token SSI — đọc số dư/danh mục dùng ngay; refresh token tự gia hạn." });
    }
    const t = need(cfg, "tcbs");
    if (!otp) throw new Error("Thiếu otp (mã iOTP từ app TCInvest).");
    const jwt = await tcbs.getToken(t.apiKey, otp);
    t.jwt = { value: jwt, expiresAt: new Date(Date.now() + 8 * 3600_000).toISOString() };
    // Tự phát hiện tiểu khoản từ claims + hồ sơ — user khỏi phải tra số.
    try {
      const claims = tcbs.decodeJwtClaims(jwt);
      t.custodyCode = t.custodyCode ?? tcbs.findCustodyCode(claims);
      if (!t.defaultAccount && t.custodyCode) {
        const profile = await tcbs.getProfile(jwt, t.custodyCode);
        const subs = profile?.bankSubAccounts ?? [];
        t.accounts = subs;
        t.defaultAccount = (subs.find((a) => a.isDefault === "Y") ?? subs[0])?.accountNo ?? null;
      }
    } catch {
      /* phát hiện tài khoản là tiện ích — lỗi không phá phiên vừa mở */
    }
    saveConfig(cfg);
    return j({
      jwt_valid: true,
      default_account: t.defaultAccount ?? null,
      message: "Đã mở phiên TCBS (JWT 8h) — đọc và đặt lệnh dùng được ngay.",
    });
  }),
);

// ── lệnh (2 bước) ───────────────────────────────────────────────────────────

server.tool(
  "place_broker_order",
  "Đặt lệnh THẬT (DNSE, SSI, TCBS — tất cả ký/gửi local). Nghi thức 2 bước bắt buộc: " +
    "gọi lần đầu KHÔNG kèm confirm → trả preview, chưa gửi gì; đọc lại cho người dùng, " +
    "CHỜ họ xác nhận rõ ràng rồi mới gọi lại với confirm=true. Không tự ý xác nhận thay.",
  {
    broker: BROKER.optional(),
    symbol: z.string(),
    side: z.string().describe("BUY/SELL (nhận cả NB/NS/MUA/BÁN)"),
    quantity: z.number().int().positive(),
    price: z.number().nonnegative().default(0).optional(),
    order_type: z.string().default("LO").optional(),
    account: z.string().optional(),
    market: z.enum(["STOCK", "DERIVATIVE"]).default("STOCK").optional(),
    confirm: z.boolean().default(false).optional(),
  },
  safe(async ({ broker = "dnse", symbol, side, quantity, price, order_type, account, market, confirm }) => {
    const cfg = loadConfig();
    const section = need(cfg, broker);
    const acc = pickAccount(section, account, broker.toUpperCase());
    const sym = String(symbol).trim().toUpperCase();
    const ot = String(order_type ?? "LO").trim().toUpperCase();
    const px = Number(price ?? 0);
    const qty = Number(quantity);
    const sideLabel = ["BUY", "NB", "B", "MUA"].includes(String(side).trim().toUpperCase()) ? "MUA" : "BÁN";
    if (ot === "LO" && px <= 0) throw new Error("Lệnh LO phải có giá > 0.");

    if (confirm !== true) {
      return j({
        status: "CONFIRM_REQUIRED",
        preview: {
          broker,
          account: acc,
          symbol: sym,
          side: sideLabel,
          quantity: qty,
          price: ot === "LO" ? px : null,
          order_type: ot,
          est_value_vnd: ot === "LO" ? Math.round(px * qty) : null,
        },
        message:
          "ĐÂY LÀ LỆNH THẬT. Đọc lại chi tiết trên cho người dùng và CHỜ họ xác nhận rõ ràng; chỉ khi đó mới gọi lại với confirm=true.",
      });
    }

    if (broker === "dnse") {
      if (!tradingTokenValid(cfg)) {
        throw new Error("Trading token DNSE chưa mở / hết hạn — request_broker_otp hoặc submit_broker_otp (smart_otp) trước.");
      }
      const mkt = market ?? "STOCK";
      const loanPackageId = await dnse.resolveLoanPackageId(section, acc, mkt, sym);
      const order = await dnse.postOrder(
        section,
        mkt,
        { accountNo: acc, symbol: sym, side: dnse.normalizeSide(side), orderType: ot, price: px, quantity: qty, loanPackageId },
        section.tradingToken.value,
      );
      return j({ order });
    }
    if (broker === "ssi") {
      if (!section.privateKeyPem) {
        throw new Error("Chưa có keypair ký lệnh SSI — chạy `link ssi` để sinh và dán public key vào iBoard.");
      }
      const token = await ssiToken(cfg); // tự refresh; hết thì báo cần OTP
      const order = await ssi.placeOrder(token, section.privateKeyPem, {
        accountNo: acc, symbol: sym, side: ssi.normalizeSide(side), quantity: qty, price: px, orderType: ot,
      });
      return j({ order });
    }
    // TCBS
    const order = await tcbs.placeStockOrder(tcbsJwt(cfg), acc, {
      symbol: sym,
      side: tcbs.normalizeSide(side),
      priceType: ot,
      price: px,
      quantity: qty,
    });
    return j({ order });
  }),
);

server.tool(
  "cancel_broker_order",
  "Huỷ một lệnh theo order_id (DNSE, SSI, TCBS). Cũng 2 bước: không confirm → preview; confirm=true mới gửi.",
  {
    broker: BROKER.optional(),
    order_id: z.string(),
    account: z.string().optional(),
    market: z.enum(["STOCK", "DERIVATIVE"]).default("STOCK").optional(),
    confirm: z.boolean().default(false).optional(),
  },
  safe(async ({ broker = "dnse", order_id, account, market, confirm }) => {
    const cfg = loadConfig();
    const section = need(cfg, broker);
    const acc = pickAccount(section, account, broker.toUpperCase());
    if (confirm !== true) {
      return j({
        status: "CONFIRM_REQUIRED",
        preview: { broker, account: acc, cancel_order_id: String(order_id) },
        message: "Huỷ lệnh thật — chờ người dùng xác nhận rồi gọi lại với confirm=true.",
      });
    }
    if (broker === "dnse") {
      if (!tradingTokenValid(cfg)) throw new Error("Trading token DNSE chưa mở / hết hạn — mở bằng OTP trước.");
      return j({
        result: await dnse.cancelOrder(section, acc, String(order_id), market ?? "STOCK", section.tradingToken.value),
      });
    }
    if (broker === "ssi") {
      if (!section.privateKeyPem) throw new Error("Chưa có keypair ký lệnh SSI — chạy `link ssi` trước.");
      const token = await ssiToken(cfg);
      return j({ result: await ssi.cancelOrder(token, section.privateKeyPem, { accountNo: acc, orderId: String(order_id) }) });
    }
    return j({ result: await tcbs.cancelStockOrders(tcbsJwt(cfg), acc, [String(order_id)]) });
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
