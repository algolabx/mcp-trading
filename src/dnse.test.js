// node --test — khoá các bất biến ký + an toàn của bridge, không đi mạng.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSignature, formatDateHeader, normalizeSide } from "./dnse.js";

test("formatDateHeader: RFC1123 UTC hậu tố +0000, không phải GMT", () => {
  const d = new Date(Date.UTC(2026, 7, 14, 9, 5, 3));
  assert.equal(formatDateHeader(d), "Fri, 14 Aug 2026 09:05:03 +0000");
});

test("buildSignature: xác định — cùng input cùng chữ ký, khác nonce khác chữ ký", () => {
  const a = buildSignature("secret", "GET", "/accounts", "Fri, 14 Aug 2026 09:05:03 +0000", "n1");
  const b = buildSignature("secret", "GET", "/accounts", "Fri, 14 Aug 2026 09:05:03 +0000", "n1");
  const c = buildSignature("secret", "GET", "/accounts", "Fri, 14 Aug 2026 09:05:03 +0000", "n2");
  assert.equal(a, b);
  assert.notEqual(a, c);
  // encodeURIComponent hoá base64 — không còn ký tự '+' thô.
  assert.ok(!a.includes("+"));
});

test("buildSignature: path ký KHÔNG kèm query (bẫy chữ ký số 1)", () => {
  // Caller phải truyền path trần — hàm không tự ý nhận query; chốt bằng việc
  // chữ ký đổi khi path đổi.
  const bare = buildSignature("s", "GET", "/accounts/1/loan-packages", "D", "n");
  const withQuery = buildSignature("s", "GET", "/accounts/1/loan-packages?symbol=GEL", "D", "n");
  assert.notEqual(bare, withQuery);
});

test("normalizeSide: nhận mọi cách gọi, từ chối chiều mơ hồ", () => {
  assert.equal(normalizeSide("NB"), "BUY");
  assert.equal(normalizeSide("mua"), "BUY");
  assert.equal(normalizeSide("SELL"), "SELL");
  assert.equal(normalizeSide("NS"), "SELL");
  assert.throws(() => normalizeSide("gì đó"));
  assert.throws(() => normalizeSide(""));
});
