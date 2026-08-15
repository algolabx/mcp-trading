// DNSE LightSpeed OpenAPI V2 — ký HMAC từng request, gọi THẲNG từ máy user.
// Port 1:1 từ src/lib/broker/dnse/v2/client.ts của algolab.vn (đã chạy prod).
// ⚠️ 2 bẫy chữ ký giữ nguyên: path ký KHÔNG kèm query string; headers= luôn là
// chuỗi cố định "(request-target) date" kể cả khi nonce nằm trong canonical.
// ⚠️ loan-packages V2 đòi symbol ("symbol is required") — khác V1.
import { createHmac, randomUUID } from "node:crypto";

const BASE = process.env.DNSE_OPENAPI_BASE ?? "https://openapi.dnse.com.vn";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** RFC1123 UTC hậu tố "+0000" — lệch định dạng là DNSE từ chối. */
export function formatDateHeader(date) {
  const p = (v) => String(v).padStart(2, "0");
  return (
    `${DAY[date.getUTCDay()]}, ${p(date.getUTCDate())} ${MONTH[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()} ${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())} +0000`
  );
}

export function buildSignature(secret, method, path, dateValue, nonce) {
  let canonical = `(request-target): ${method.toLowerCase()} ${path}\ndate: ${dateValue}`;
  if (nonce) canonical += `\nnonce: ${nonce}`;
  const raw = createHmac("sha256", Buffer.from(secret, "utf8")).update(canonical, "utf8").digest("base64");
  return encodeURIComponent(raw);
}

function signatureHeaders(creds, method, path, now) {
  const dateValue = formatDateHeader(now);
  const nonce = randomUUID().replace(/-/g, "");
  const signature = buildSignature(creds.apiSecret, method, path, dateValue, nonce);
  return {
    Date: dateValue,
    "x-api-key": creds.apiKey,
    "X-Signature":
      `Signature keyId="${creds.apiKey}",algorithm="hmac-sha256",` +
      `headers="(request-target) date",signature="${signature}",nonce="${nonce}"`,
  };
}

export class DnseError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.name = "DnseError";
    this.status = status;
    this.detail = detail;
  }
}

async function call(creds, method, path, opts = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const headers = {
    Accept: "application/json",
    ...signatureHeaders(creds, method, path, new Date()),
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.tradingToken) headers["trading-token"] = opts.tradingToken;

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text.slice(0, 200) };
  }
  if (!res.ok) {
    throw new DnseError(res.status, body.message ?? `Lỗi DNSE (HTTP ${res.status}).`, body);
  }
  return body;
}

// ── OTP / trading token ─────────────────────────────────────────────────────

export function sendEmailOtp(creds, email) {
  return call(creds, "POST", "/registration/send-email-otp", {
    body: { email, otpType: "email_otp" },
  });
}

export async function createTradingToken(creds, otpType, passcode) {
  const body = await call(creds, "POST", "/registration/trading-token", {
    body: { otpType, passcode },
  });
  const token = body.tradingToken ?? body.token;
  if (!token) throw new DnseError(500, "DNSE không trả trading token.");
  return token;
}

// ── đọc tài khoản ───────────────────────────────────────────────────────────

export async function getAccounts(creds) {
  const body = await call(creds, "GET", "/accounts");
  return Array.isArray(body) ? body : (body.accounts ?? []);
}

export function getBalances(creds, accountNo) {
  return call(creds, "GET", `/accounts/${accountNo}/balances`);
}

export async function getLoanPackages(creds, accountNo, marketType, symbol) {
  const body = await call(creds, "GET", `/accounts/${accountNo}/loan-packages`, {
    query: { marketType, ...(symbol ? { symbol } : {}) },
  });
  return Array.isArray(body) ? body : (body.loanPackages ?? []);
}

export async function getPositions(creds, accountNo, marketType) {
  const body = await call(creds, "GET", `/accounts/${accountNo}/positions`, {
    query: { marketType },
  });
  return Array.isArray(body) ? body : (body.positions ?? []);
}

export async function getOrders(creds, accountNo, marketType) {
  const body = await call(creds, "GET", `/accounts/${accountNo}/orders`, {
    query: { marketType },
  });
  return Array.isArray(body) ? body : (body.orders ?? []);
}

// ── lệnh ────────────────────────────────────────────────────────────────────

/** Gói vay: hỏi theo symbol (V2 bắt buộc); không ra thì lấy từ position. */
export async function resolveLoanPackageId(creds, accountNo, marketType, symbol) {
  try {
    const packages = await getLoanPackages(creds, accountNo, marketType, symbol);
    const cash = packages.find((p) => p.type === "N") ?? packages[0];
    if (cash) return cash.id;
  } catch {
    /* fallback position bên dưới */
  }
  const positions = await getPositions(creds, accountNo, marketType);
  const held = positions.find((p) => p.symbol === symbol)?.loanPackageId;
  if (held == null) throw new DnseError(400, `Không lấy được gói vay (loanPackageId) cho ${symbol}.`);
  return held;
}

export function postOrder(creds, marketType, payload, tradingToken) {
  // accountNo nằm trong BODY — path /accounts/orders không mang tiểu khoản.
  return call(creds, "POST", "/accounts/orders", {
    query: { marketType },
    body: payload,
    tradingToken,
  });
}

export function cancelOrder(creds, accountNo, orderId, marketType, tradingToken) {
  return call(creds, "DELETE", `/accounts/${accountNo}/orders/${orderId}`, {
    query: { marketType },
    tradingToken,
  });
}

/** BUY/SELL/NB/NS/MUA/BÁN → BUY|SELL; không nhận diện được thì throw (không đoán chiều lệnh thật). */
export function normalizeSide(side) {
  const s = String(side ?? "").trim().toUpperCase();
  if (["BUY", "NB", "B", "MUA"].includes(s)) return "BUY";
  if (["SELL", "NS", "S", "BAN", "BÁN"].includes(s)) return "SELL";
  throw new DnseError(400, `Chiều lệnh không hợp lệ: ${side}`);
}
