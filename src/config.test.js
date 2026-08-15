import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Trỏ config vào file tạm TRƯỚC khi import module (module đọc env lúc load).
const TMP = join(tmpdir(), `mcp-broker-test-${process.pid}.json`);
process.env.ALGOLAB_MCP_BROKER_CONFIG = TMP;
const { loadConfig, saveConfig, tradingTokenValid } = await import("./config.js");

test("saveConfig: file quyền 600 — chỉ chủ máy đọc được", () => {
  saveConfig({ dnse: { apiKey: "k", apiSecret: "s" } });
  const mode = statSync(TMP).mode & 0o777;
  assert.equal(mode, 0o600);
  assert.equal(loadConfig().dnse.apiKey, "k");
  rmSync(TMP);
});

test("tradingTokenValid: hết hạn / thiếu đều false, còn hạn true", () => {
  const now = new Date("2026-08-14T10:00:00Z");
  assert.equal(tradingTokenValid({}, now), false);
  assert.equal(
    tradingTokenValid({ dnse: { tradingToken: { value: "t", expiresAt: "2026-08-14T09:00:00Z" } } }, now),
    false,
  );
  assert.equal(
    tradingTokenValid({ dnse: { tradingToken: { value: "t", expiresAt: "2026-08-14T18:00:00Z" } } }, now),
    true,
  );
});
