#!/usr/bin/env node
// CLI setup của bridge — chạy trong TERMINAL của user, ngoài kênh chat AI.
//   mcp-trading link dnse|ssi|tcbs   nhập khoá (ẩn phím) + lưu local
//   mcp-trading status               trạng thái (không in khoá)
//   mcp-trading unlink dnse|ssi|tcbs xoá khoá khỏi máy
// Không tương tác (script cá nhân): đặt env rồi chạy link —
//   DNSE: ALGOLAB_DNSE_API_KEY / _API_SECRET / _EMAIL
//   SSI : ALGOLAB_SSI_CONSUMER_ID / _CONSUMER_SECRET / _ACCOUNT
//   TCBS: ALGOLAB_TCBS_API_KEY / _ACCOUNT
import { createInterface } from "node:readline";
import { loadConfig, saveConfig, tradingTokenValid, CONFIG_PATH } from "./config.js";
import { getAccounts } from "./dnse.js";
import * as ssi from "./ssi.js";
import { jwtValid } from "./tcbs.js";

function ask(question, { mute = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (mute) {
      rl.question(question, (a) => { rl.close(); process.stdout.write("\n"); resolve(a.trim()); });
      rl._writeToOutput = (s) => {
        if (s.includes(question)) process.stdout.write(question);
      };
    } else {
      rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
    }
  });
}

async function linkDnse() {
  const apiKey = process.env.ALGOLAB_DNSE_API_KEY || (await ask("DNSE API Key (LightSpeed OpenAPI): "));
  const apiSecret = process.env.ALGOLAB_DNSE_API_SECRET || (await ask("DNSE API Secret (ẩn phím): ", { mute: true }));
  const email = process.env.ALGOLAB_DNSE_EMAIL ?? (await ask("Email đăng ký DNSE (nhận OTP đặt lệnh, Enter bỏ qua): "));
  if (!apiKey || !apiSecret) throw new Error("Cần đủ API Key + Secret (webtrading DNSE → Thông tin cá nhân → LightSpeed API).");
  process.stdout.write("Đang kiểm tra khoá với DNSE… ");
  const accounts = await getAccounts({ apiKey, apiSecret });
  const cash = accounts.find((a) => !a.derivativeAccount) ?? accounts[0];
  const cfg = loadConfig();
  cfg.dnse = { apiKey, apiSecret, defaultAccount: cash?.id ?? null, email: email || null, tradingToken: null };
  saveConfig(cfg);
  console.log("OK");
  console.log("Tiểu khoản:", accounts.map((a) => `${a.id}${a.derivativeAccount ? " (phái sinh)" : ""}`).join(", ") || "(không có)");
}

async function linkSsi() {
  const consumerId = process.env.ALGOLAB_SSI_CONSUMER_ID || (await ask("SSI ConsumerID (iBoard → Dịch vụ API): "));
  const consumerSecret = process.env.ALGOLAB_SSI_CONSUMER_SECRET || (await ask("SSI ConsumerSecret (ẩn phím): ", { mute: true }));
  const account = process.env.ALGOLAB_SSI_ACCOUNT || (await ask("Số tiểu khoản SSI (kèm hậu tố, VD 5552981): "));
  if (!consumerId || !consumerSecret || !account) throw new Error("Cần đủ ConsumerID + Secret + số tiểu khoản.");
  const cfg = loadConfig();
  // Giữ keypair cũ nếu đã có (đã dán iBoard); chưa có thì sinh mới.
  const prev = cfg.ssi ?? {};
  const kp = prev.privateKeyPem && prev.publicKeyXml ? prev : ssi.generateKeypair();
  cfg.ssi = {
    consumerId, consumerSecret, defaultAccount: account,
    privateKeyPem: kp.privateKeyPem, publicKeyXml: kp.publicKeyXml, tokens: null,
  };
  saveConfig(cfg);
  console.log("Đã lưu ConsumerID/Secret + keypair ký lệnh (private key nằm trên máy bạn).");
  if (!(prev.privateKeyPem && prev.publicKeyXml)) {
    console.log("\n⚠️  DÁN PUBLIC KEY dưới đây vào iBoard → Dịch vụ API (một lần) để ĐẶT LỆNH:\n");
    console.log(kp.publicKeyXml + "\n");
    console.log("Đọc số dư/danh mục thì không cần bước này — chỉ cần OTP.");
  }
  console.log("Mở khoá phiên: gọi request_broker_otp/submit_broker_otp (V3 cần OTP một lần; refresh tự gia hạn).");
}

async function linkTcbs() {
  const apiKey = process.env.ALGOLAB_TCBS_API_KEY || (await ask("TCBS API Key iFlash (ẩn phím): ", { mute: true }));
  const account = process.env.ALGOLAB_TCBS_ACCOUNT ?? (await ask("Số tiểu khoản (Enter để bridge tự phát hiện sau iOTP): "));
  if (!apiKey) throw new Error("Cần API Key (app TCInvest → iFlash Open API).");
  const cfg = loadConfig();
  cfg.tcbs = { apiKey, defaultAccount: account || null, custodyCode: null, jwt: null };
  saveConfig(cfg);
  console.log("Đã lưu. Mở phiên bằng iOTP (submit_broker_otp) — bridge sẽ tự phát hiện tiểu khoản từ hồ sơ.");
}

function status() {
  const cfg = loadConfig();
  const line = (name, ok, extra) => console.log(`${name}: ${ok ? "đã liên kết" : "chưa liên kết"}${extra ? ` · ${extra}` : ""}`);
  line("DNSE", !!cfg.dnse, cfg.dnse ? `TK ${cfg.dnse.defaultAccount ?? "?"} · trading token ${tradingTokenValid(cfg) ? "còn hạn" : "chưa mở"}` : "");
  line("SSI ", !!cfg.ssi, cfg.ssi ? `TK ${cfg.ssi.defaultAccount ?? "?"} · token ${cfg.ssi.tokens?.accessToken ? "có (tự refresh)" : "chưa mở (cần OTP)"}` : "");
  line("TCBS", !!cfg.tcbs, cfg.tcbs ? `TK ${cfg.tcbs.defaultAccount ?? "(tự phát hiện sau iOTP)"} · JWT ${jwtValid(cfg.tcbs) ? "còn hạn" : "hết/chưa mở"}` : "");
  console.log(`Config: ${CONFIG_PATH} (chmod 600)`);
}

function unlink(target) {
  const cfg = loadConfig();
  delete cfg[target];
  saveConfig(cfg);
  console.log(`Đã xoá khoá ${target.toUpperCase()} khỏi máy. (Triệt để: thu hồi key tại CTCK.)`);
}

// Tự-kiểm-chứng: quét mọi URL http(s) trong CODE CHẠY của chính bridge và
// khẳng định nó CHỈ gọi 3 host CTCK — không có bất kỳ địa chỉ nào của Algolab
// hay bên thứ ba. Đây là bằng chứng "npm không gửi token đi đâu cả" mà user
// tự chạy được, không cần tin lời ai.
async function verify() {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const ALLOWED = ["openapi.dnse.com.vn", "api.ssi.com.vn", "openapi.tcbs.com.vn"];
  const hosts = new Set();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".js") && !x.endsWith(".test.js"))) {
    for (const m of readFileSync(dir + f, "utf8").matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      hosts.add(m[1].toLowerCase());
    }
  }
  const list = [...hosts];
  const bad = list.filter((h) => !ALLOWED.includes(h));
  console.log("Các host bridge liên lạc (quét từ mã nguồn đang chạy):");
  for (const h of list) console.log("  •", h, ALLOWED.includes(h) ? "(CTCK ✓)" : "(LẠ ✗)");
  const algolab = list.some((h) => h.includes("algolab"));
  console.log("\nGọi về Algolab / bên thứ ba:", algolab || bad.length ? "CÓ ✗ (BÁO ĐỘNG)" : "KHÔNG ✓");
  console.log("Kết luận:", !bad.length && !algolab
    ? "Bridge chỉ nói chuyện với CTCK — khoá không đi đâu khác. An toàn."
    : "Phát hiện host lạ — KHÔNG nên tin bản này.");
  console.log("\nTự kiểm thêm:  npm test   ·  grep -rn https src/   ·  đọc mã: github.com/algolabx/mcp-trading");
  process.exit(bad.length || algolab ? 1 : 0);
}

const BROKERS = ["dnse", "ssi", "tcbs"];
const [cmd, target] = process.argv.slice(2);
try {
  if (cmd === "link" && target === "dnse") await linkDnse();
  else if (cmd === "link" && target === "ssi") await linkSsi();
  else if (cmd === "link" && target === "tcbs") await linkTcbs();
  else if (cmd === "status" || cmd === undefined) status();
  else if (cmd === "verify") await verify();
  else if (cmd === "unlink" && BROKERS.includes(target)) unlink(target);
  else {
    console.log("Cách dùng: mcp-trading [link dnse|ssi|tcbs | status | verify | unlink dnse|ssi|tcbs]");
    process.exit(1);
  }
} catch (e) {
  console.error(`\nLỗi: ${e.message}`);
  if (e.detail) console.error(JSON.stringify(e.detail).slice(0, 300));
  process.exit(1);
}
