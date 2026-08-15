// SSI FastConnect V3 — port từ src/lib/broker/ssi/v3/client.ts (prod).
// Bridge hỗ trợ ĐỌC + OTP + refresh token. ĐẶT LỆNH SSI không đưa vào bridge:
// ký lệnh cần keypair RSA đăng ký iBoard — chỉ đăng ký được MỘT public key,
// và key đó đang thuộc về server (đường remote). Đọc thì chỉ cần token OTP.
// ⚠️ 3 bẫy V3 (đã trả giá 14/08): clientId = ConsumerID, không được rỗng;
// account phải kèm hậu tố tiểu khoản (5552981…); orderBook đòi from/to YYYY/MM/DD.
const BASE = process.env.SSI_V3_BASE ?? "https://api.ssi.com.vn";

const EP = {
  token: "/api/v3/auth/token",
  refresh: "/api/v3/auth/refresh",
  requestOtp: "/api/v3/auth/requestOtp",
  accountBalance: "/api/v3/trading/accountBalance",
  position: "/api/v3/trading/position",
  orderBook: "/api/v3/trading/orderBook",
  accountInfo: "/api/v3/account/info",
};

export class SsiError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.name = "SsiError";
    this.status = status;
    this.detail = detail;
  }
}

function unwrap(json) {
  const obj = json ?? {};
  return obj.data !== undefined && obj.data !== null ? obj.data : obj;
}

async function request(method, path, opts = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const headers = { Accept: "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let payload;
  if (opts.body !== undefined) {
    payload = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url.toString(), { method, headers, body: payload });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const candidates = [json.message, json.error_description, json.error, json.detail, json.title];
    let msg = candidates.find((v) => typeof v === "string" && v.trim()) ?? `Lỗi SSI (HTTP ${res.status}).`;
    if (json.errors && typeof json.errors === "object") msg += ` — ${JSON.stringify(json.errors).slice(0, 200)}`;
    throw new SsiError(res.status, msg, json);
  }
  return unwrap(json);
}

export function requestOtp(consumerId, consumerSecret) {
  return request("POST", EP.requestOtp, { body: { apiKey: consumerId, apiSecret: consumerSecret } });
}

export function getToken(consumerId, consumerSecret, otp, transactionId) {
  const body = { apiKey: consumerId, apiSecret: consumerSecret };
  if (otp) body.otp = otp;
  if (transactionId) body.transactionId = transactionId;
  return request("POST", EP.token, { body });
}

export function refreshToken(refresh) {
  return request("POST", EP.refresh, { body: { refreshToken: refresh } });
}

export function getAccountInfo(token) {
  return request("GET", EP.accountInfo, { token });
}

export function getBalance(token, account, clientId) {
  return request("GET", EP.accountBalance, { token, params: { clientId, accountNo: account } });
}

export function getPositions(token, account, clientId) {
  return request("GET", EP.position, { token, params: { clientId, accountNo: account } });
}

function vnDateStr(now) {
  const vn = new Date(now.getTime() + 7 * 3600_000);
  const p = (v) => String(v).padStart(2, "0");
  return `${vn.getUTCFullYear()}/${p(vn.getUTCMonth() + 1)}/${p(vn.getUTCDate())}`;
}

export async function getOrderBook(token, account) {
  const today = vnDateStr(new Date());
  const data = await request("GET", EP.orderBook, {
    token,
    params: { accountNo: account, from: today, to: today, pageIndex: 1, pageSize: 1000 },
  });
  if (Array.isArray(data)) return data;
  return data.orders ?? [];
}

/** epochAt giây hoặc ms → ISO; fallback theo giờ. */
function expiryIso(epochAt, now, fallbackHours) {
  if (typeof epochAt === "number" && epochAt > 0) {
    const ms = epochAt > 1e12 ? epochAt : epochAt * 1000;
    if (ms > now.getTime()) return new Date(ms).toISOString();
  }
  return new Date(now.getTime() + fallbackHours * 3600_000).toISOString();
}

export function tokensFromResponse(token, now = new Date()) {
  const out = {
    accessToken: token.accessToken,
    accessExpiresAt: expiryIso(token.expiresAt, now, 8),
  };
  if (token.refreshToken) {
    out.refreshToken = token.refreshToken;
    out.refreshExpiresAt = expiryIso(token.refreshExpiresAt, now, 24 * 7);
  }
  return out;
}

const SKEW_MS = 30_000;
const valid = (iso, now) => !!iso && new Date(iso).getTime() - SKEW_MS > now.getTime();

/** Access token tươi từ config.ssi.tokens; hết hạn thì refresh; hết cả → null (cần OTP). */
export async function freshAccessToken(ssiCfg, persist, now = new Date()) {
  const t = ssiCfg.tokens ?? {};
  if (t.accessToken && valid(t.accessExpiresAt, now)) return t.accessToken;
  if (t.refreshToken && valid(t.refreshExpiresAt, now)) {
    const renewed = await refreshToken(t.refreshToken);
    if (renewed.accessToken) {
      ssiCfg.tokens = { ...t, ...tokensFromResponse(renewed, now) };
      await persist();
      return ssiCfg.tokens.accessToken;
    }
  }
  return null;
}
