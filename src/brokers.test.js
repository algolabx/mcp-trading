// node --test — bất biến SSI/TCBS của bridge, không đi mạng.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokensFromResponse, freshAccessToken } from "./ssi.js";
import { buildStockOrderPayload, normalizeSide, jwtValid, findCustodyCode, decodeJwtClaims } from "./tcbs.js";

test("ssi tokensFromResponse: epoch giây/ms đều ra ISO, fallback 8h/7d", () => {
  const now = new Date("2026-08-14T10:00:00Z");
  const t = tokensFromResponse({ accessToken: "A", refreshToken: "R" }, now);
  assert.equal(t.accessExpiresAt, "2026-08-14T18:00:00.000Z");
  assert.equal(t.refreshExpiresAt, "2026-08-21T10:00:00.000Z");
  const t2 = tokensFromResponse({ accessToken: "A", expiresAt: Math.floor(new Date("2026-08-14T12:00:00Z").getTime() / 1000) }, now);
  assert.equal(t2.accessExpiresAt, "2026-08-14T12:00:00.000Z");
});

test("ssi freshAccessToken: access còn hạn thì trả ngay, hết cả thì null (cần OTP)", async () => {
  const now = new Date("2026-08-14T10:00:00Z");
  const live = { tokens: { accessToken: "A", accessExpiresAt: "2026-08-14T12:00:00Z" } };
  assert.equal(await freshAccessToken(live, async () => {}, now), "A");
  const dead = { tokens: { accessToken: "A", accessExpiresAt: "2026-08-14T09:00:00Z" } };
  assert.equal(await freshAccessToken(dead, async () => {}, now), null);
});

test("tcbs buildStockOrderPayload: LO cần giá, MP price=0, execType NB/NS", () => {
  const lo = buildStockOrderPayload({ symbol: "gel", side: "NS", priceType: "LO", price: 30000, quantity: 100 });
  assert.deepEqual(lo, { symbol: "GEL", execType: "NS", priceType: "LO", price: 30000, quantity: 100 });
  const mp = buildStockOrderPayload({ symbol: "GEL", side: "NB", priceType: "MP", price: 0, quantity: 100 });
  assert.equal(mp.price, 0);
  assert.throws(() => buildStockOrderPayload({ symbol: "GEL", side: "NS", priceType: "LO", price: 0, quantity: 100 }));
  assert.throws(() => buildStockOrderPayload({ symbol: "GEL", side: "NS", priceType: "LO", price: 30000, quantity: 0 }));
});

test("tcbs normalizeSide → NB/NS; jwtValid theo hạn; custody từ claims", () => {
  assert.equal(normalizeSide("BUY"), "NB");
  assert.equal(normalizeSide("bán"), "NS");
  assert.throws(() => normalizeSide("x"));
  const now = new Date("2026-08-14T10:00:00Z");
  assert.equal(jwtValid({ jwt: { value: "j", expiresAt: "2026-08-14T18:00:00Z" } }, now), true);
  assert.equal(jwtValid({ jwt: { value: "j", expiresAt: "2026-08-14T09:00:00Z" } }, now), false);
  const claims = { custodyID: "105CO78989", tcbsId: "10000539428" };
  assert.equal(findCustodyCode(claims), "105CO78989");
  // decode payload thật của một JWT giả
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  assert.deepEqual(decodeJwtClaims(`h.${payload}.s`), claims);
});
