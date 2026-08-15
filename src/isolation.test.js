// Bất biến TẦNG C: bridge KHÔNG được liên lạc với Algolab — khoá & mọi
// request chỉ đi tới host CTCK, từ máy user. Test này canh gác để không ai
// vô tình thêm một fetch về algolab.vn (telemetry, "tiện" gửi metadata…)
// mà quên rằng đó phá vỡ lời hứa zero-exposure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL(".", import.meta.url).pathname;
const RUNTIME = readdirSync(SRC).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));

const ALLOWED_HOSTS = ["openapi.dnse.com.vn", "api.ssi.com.vn", "openapi.tcbs.com.vn"];

test("mọi URL http(s) trong code chạy chỉ trỏ tới host CTCK cho phép", () => {
  const found = new Set();
  for (const f of RUNTIME) {
    const src = readFileSync(join(SRC, f), "utf8");
    for (const m of src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) found.add(m[1].toLowerCase());
  }
  for (const host of found) {
    assert.ok(
      ALLOWED_HOSTS.includes(host),
      `Host lạ trong bridge: "${host}". Bridge chỉ được gọi CTCK, KHÔNG gọi Algolab hay bất kỳ đâu khác.`,
    );
  }
  // Bảo đảm ít nhất còn đủ 3 host CTCK (chống việc xoá nhầm base URL).
  for (const h of ALLOWED_HOSTS) assert.ok(found.has(h), `Thiếu host CTCK: ${h}`);
});

test("không có fetch/import nào chạm domain algolab", () => {
  for (const f of RUNTIME) {
    const src = readFileSync(join(SRC, f), "utf8");
    // Cho phép chữ "algolab" trong tên tool / đường dẫn CLI / thông điệp, nhưng
    // KHÔNG cho phép nó đứng trong một URL hay lời gọi fetch.
    assert.equal(
      /https?:\/\/[^\s"'`]*algolab/i.test(src),
      false,
      `${f} chứa URL algolab — bridge phải zero-exposure với Algolab.`,
    );
  }
});
