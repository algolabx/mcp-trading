// Kho khoá LOCAL của bridge — file ~/.algolab/mcp-broker.json, chmod 600.
// Đây chính là lời hứa Tầng C: khoá không rời máy user. KHÔNG bao giờ gửi
// nội dung file này đi đâu; tool MCP cũng không có đường nhận/трả khoá.
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export const CONFIG_PATH =
  process.env.ALGOLAB_MCP_BROKER_CONFIG ?? join(homedir(), ".algolab", "mcp-broker.json");

/** @returns {{dnse?: {apiKey: string, apiSecret: string, defaultAccount?: string|null, email?: string|null, tradingToken?: {value: string, expiresAt: string}|null}}} */
export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function saveConfig(cfg) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  // writeFileSync mode chỉ áp cho file MỚI — file có sẵn phải chmod tay.
  chmodSync(CONFIG_PATH, 0o600);
}

/** Trading token còn hạn (đệm 30s)? */
export function tradingTokenValid(cfg, now = new Date()) {
  const t = cfg.dnse?.tradingToken;
  if (!t?.value || !t?.expiresAt) return false;
  return new Date(t.expiresAt).getTime() - 30_000 > now.getTime();
}

export const NOT_LINKED_MSG =
  "Chưa liên kết DNSE trên máy này. Chạy trong terminal (KHÔNG dán khoá vào chat):\n" +
  "  npx mcp-trading link dnse\n" +
  "Khoá lấy từ webtrading DNSE → Thông tin cá nhân → LightSpeed API; " +
  "lưu tại ~/.algolab/mcp-broker.json quyền 600 (chỉ mình bạn đọc) và không rời máy bạn.";
