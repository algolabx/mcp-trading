// TCBS iFlash Open API — port từ src/lib/broker/tcbs/* (prod).
// JWT 8h đổi từ API Key + iOTP (app TCInvest); mọi call sau chỉ Bearer JWT.
// ⚠️ Bẫy 14/08: accountNo là dãy riêng (0001I63918…) — custodyID/tcbsId KHÔNG
// phải accountNo; danh sách tiểu khoản lấy từ get-profile PHẢI kèm
// ?fields=basicInfo,bankSubAccounts.
const BASE = process.env.TCBS_API_BASE ?? "https://openapi.tcbs.com.vn";

export class TcbsError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.name = "TcbsError";
    this.status = status;
    this.detail = detail;
  }
}

async function call(path, { method = "GET", jwt, body } = {}) {
  const headers = { Accept: "application/json" };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: text.slice(0, 200) };
  }
  if (!res.ok) throw new TcbsError(res.status, json.message ?? `Lỗi TCBS (HTTP ${res.status}).`, json);
  return json;
}

export async function getToken(apiKey, otp) {
  const body = await call("/gaia/v1/oauth2/openapi/token", { method: "POST", body: { apiKey, otp } });
  if (!body.token) throw new TcbsError(502, "TCBS không trả token.");
  return body.token;
}

export function decodeJwtClaims(jwt) {
  const part = jwt.split(".")[1];
  if (!part) throw new TcbsError(400, "JWT không đúng định dạng.");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

export function findCustodyCode(claims) {
  const m = JSON.stringify(claims).match(/105C\w{6,}/);
  return m ? m[0] : null;
}

export function getProfile(jwt, custodyCode) {
  return call(`/eros/v2/get-profile/by-username/${custodyCode}?fields=basicInfo,bankSubAccounts`, { jwt });
}

export function getStockAsset(jwt, accountNo) {
  return call(`/aion/v1/accounts/${accountNo}/se`, { jwt });
}

export function getStockCash(jwt, accountNo) {
  return call(`/aion/v1/accounts/${accountNo}/cashInvestments`, { jwt });
}

export async function getStockOrderBook(jwt, accountNo) {
  const body = await call(`/aion/v1/accounts/${accountNo}/orders`, { jwt });
  return body.data ?? [];
}

const NEEDS_PRICE = new Set(["LO", "PLO"]);

/** Body đặt lệnh: { symbol, execType NB/NS, priceType, price integer, quantity }. */
export function buildStockOrderPayload({ symbol, side, priceType, price, quantity }) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new TcbsError(400, "Khối lượng phải là số nguyên dương.");
  const needsPrice = NEEDS_PRICE.has(priceType);
  if (needsPrice && !(price > 0)) throw new TcbsError(400, `Lệnh ${priceType} cần giá dương.`);
  return {
    symbol: String(symbol).toUpperCase(),
    execType: side, // NB / NS
    priceType,
    price: needsPrice ? Math.round(price) : 0,
    quantity,
  };
}

export function placeStockOrder(jwt, accountNo, input) {
  return call(`/akhlys/v1/accounts/${accountNo}/orders`, {
    method: "POST",
    jwt,
    body: buildStockOrderPayload(input),
  });
}

/** Huỷ: PUT cancel-orders — body { ordersList: [{orderID}] }. */
export function cancelStockOrders(jwt, accountNo, orderIds) {
  return call(`/akhlys/v1/accounts/${accountNo}/cancel-orders`, {
    method: "PUT",
    jwt,
    body: { ordersList: orderIds.map((orderID) => ({ orderID })) },
  });
}

/** BUY/SELL/MUA/BÁN/B/S → NB|NS (execType TCBS). */
export function normalizeSide(side) {
  const s = String(side ?? "").trim().toUpperCase();
  if (["BUY", "NB", "B", "MUA"].includes(s)) return "NB";
  if (["SELL", "NS", "S", "BAN", "BÁN"].includes(s)) return "NS";
  throw new TcbsError(400, `Chiều lệnh không hợp lệ: ${side}`);
}

const SKEW_MS = 30_000;
export function jwtValid(tcbsCfg, now = new Date()) {
  const t = tcbsCfg?.jwt;
  if (!t?.value || !t?.expiresAt) return false;
  return new Date(t.expiresAt).getTime() - SKEW_MS > now.getTime();
}
