/**
 * UI verification driver.
 *
 * Runs the real DApp in a headless Chromium with an injected MetaMask-like
 * wallet and a local Hardhat node + local IPFS server, then exercises every
 * contract endpoint THROUGH the frontend UI:
 *   connect -> upload (uploadFile + owner self-grant) -> list My Files
 *   -> grant access -> Shared With Me -> download+decrypt -> revoke
 *   -> expiry -> Activity Log (blockchain events).
 *
 * This is not a unit/E2E test suite; it is the way the project's endpoints
 * are verified via the UI, per the project brief.
 */
import { chromium } from "playwright-core";
import { getEncryptionPublicKey, decryptSafely } from "@metamask/eth-sig-util";
import { HDNodeWallet } from "ethers";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FRONTEND = path.join(ROOT, "frontend");

const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ||
  path.join(process.env.HOME, ".cache/ms-playwright/chromium-1234/chrome-linux64/chrome");

const MNEMONIC =
  "test test test test test test test test test test test junk";
const ACCOUNT_A = HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/60'/0'/0/0");
const ACCOUNT_B = HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/60'/0'/0/1");

const SAMPLE_FILE = Buffer.from(
  "Decentralized File Sharing System (Web3) verification payload.\n" +
    "This file must survive client-side encryption, IPFS pinning, on-chain " +
    "registration, access-granted sharing, download and decryption unchanged.\n"
);

let failures = 0;
const PROCS = [];
function cleanupProcs() {
  for (const p of PROCS) {
    try {
      process.kill(-p.pid, "SIGKILL");
    } catch {
      /* ignore */
    }
  }
}
function check(name, ok, extra = "") {
  if (ok) {
    console.log(`  ✔ ${name}`);
  } else {
    failures++;
    console.error(`  ✘ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const sleep = (ms) => delay(ms);

function runCmd(cmd, args, cwd, opts = {}) {
  const result = execFileSync(cmd, args, { cwd, encoding: "utf8", ...opts });
  return result;
}

function spawnProc(cmd, args, cwd, logName) {
  const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.unref();
  const logPath = `/tmp/opencode/${logName}.log`;
  const stream = fs.createWriteStream(logPath, { flags: "a" });
  child.stdout.on("data", (d) => {
    stream.write(d);
    if (process.env.DEBUG_TESTS) process.stdout.write(`[${logName}] ${d}`);
  });
  child.stderr.on("data", (d) => {
    stream.write(d);
    if (process.env.DEBUG_TESTS) process.stderr.write(`[${logName}] ${d}`);
  });
  child.on("exit", (code) => {
    stream.end();
  });
  child.__logPath = logPath;
  return child;
}

async function waitForOutput(child, regex, timeoutMs = 60000) {
  const re = new RegExp(regex);
  await waitFor(
    async () => {
      try {
        const content = fs.readFileSync(child.__logPath, "utf8");
        return re.test(content);
      } catch {
        return false;
      }
    },
    timeoutMs,
    400,
    `output /${regex}/ in ${child.__logPath}`
  );
  return fs.readFileSync(child.__logPath, "utf8");
}

async function waitFor(fn, timeoutMs, intervalMs = 250, label = "condition") {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await fn()) return true;
    } catch {
      /* retry */
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

/** Wait for a .file-card containing the given file name to appear. */
async function waitForCard(page, fileName, timeoutMs = 30000, label = "file card") {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const n = await page.evaluate(
      (text) =>
        Array.from(document.querySelectorAll(".file-card")).filter((c) =>
          c.textContent.includes(text)
        ).length,
      fileName
    );
    if (n > 0) return true;
    await sleep(400);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function waitForRpc(port, timeoutMs = 40000) {
  await waitFor(
    async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        });
        if (!res.ok) return false;
        const json = await res.json();
        return !!json.result;
      } catch {
        return false;
      }
    },
    timeoutMs,
    400,
    `rpc on port ${port}`
  );
}

async function waitForHttp(url, timeoutMs = 30000) {
  await waitFor(
    async () => {
      try {
        const res = await fetch(url);
        return res.ok;
      } catch {
        return false;
      }
    },
    timeoutMs,
    300,
    `http ${url}`
  );
}

async function deployWithRetry() {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return runCmd("npx", ["hardhat", "run", "scripts/deploy.js", "--network", "localhost"], ROOT);
    } catch (err) {
      lastErr = err;
      console.warn(`  deploy attempt ${attempt} failed, retrying…`);
      await sleep(1500);
    }
  }
  throw lastErr;
}
async function rpc(port, method, params = []) {
  const res = await fetch(`http://127.0.0.1:${port}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

async function main() {
  const a = ACCOUNT_A.address;
  const b = ACCOUNT_B.address;

  try {
    console.log("=== Starting local test stack ===");

    // 1. Hardhat node
    const nodeProc = spawnProc("npx", ["hardhat", "node"], ROOT, "hardhat-node");
    PROCS.push(nodeProc);
    await waitForOutput(nodeProc, "Started HTTP and WebSocket JSON-RPC server");
    console.log("  hardhat node: up");

    // 2. Deploy contract
    const deployOut = await deployWithRetry();
    const addressMatch = deployOut.match(/FileRegistry deployed to: (0x[0-9a-fA-F]{40})/);
    if (!addressMatch) throw new Error("Could not parse deployed contract address");
    const contractAddress = addressMatch[1];
    console.log(`  contract deployed: ${contractAddress}`);

    // 3. Local IPFS server
    PROCS.push(spawnProc("node", ["testing/local-ipfs-server.mjs"], ROOT, "local-ipfs"));
    await waitForHttp("http://127.0.0.1:9099/health", 20000);    console.log("  local ipfs: up");

    // 4. Configure + start vite dev server
    // REAL_IPFS=1 uses a real Pinata JWT (from root .env PINATA_JWT or the
    // REAL_IPFS_JWT env var) so uploads/downloads go through real IPFS.
    let pinataJwt = "";
    let localIpfsUrl = "http://127.0.0.1:9099";
    if (process.env.REAL_IPFS) {
      pinataJwt = process.env.REAL_IPFS_JWT || "";
      if (!pinataJwt) {
        const rootEnv = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
        const line = rootEnv.split("\n").find((l) => l.startsWith("PINATA_JWT="));
        if (line) pinataJwt = line.slice("PINATA_JWT=".length).trim();
      }
      if (!pinataJwt) throw new Error("REAL_IPFS=1 requires PINATA_JWT in root .env");
      localIpfsUrl = "";
    }
    fs.writeFileSync(
      path.join(FRONTEND, ".env"),
      [
        `VITE_CONTRACT_ADDRESS=${contractAddress}`,
        "VITE_CHAIN_ID=1337",
        "VITE_SEPOLIA_RPC_URL=http://127.0.0.1:8545",
        `VITE_LOCAL_IPFS_URL=${localIpfsUrl}`,
        `VITE_PINATA_JWT=${pinataJwt}`,
        "",
      ].join("\n")
    );
    PROCS.push(spawnProc("npm", ["run", "dev", "--", "--port", "5179", "--strictPort"], FRONTEND, "vite"));
    await waitForHttp("http://127.0.0.1:5179", 40000);
    console.log("  vite dev server: up");

    // Derive encryption public keys for both accounts (used by the mock wallet)
    const pubA = getEncryptionPublicKey(ACCOUNT_A.privateKey.slice(2));
    const pubB = getEncryptionPublicKey(ACCOUNT_B.privateKey.slice(2));

    // 5. Browser + mock wallet
    const browser = await chromium.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error("[page error]", e.message));
    page.on("console", (m) => {
      if (m.type() === "error") console.error("[console error]", m.text());
    });

    await page.exposeFunction("__mockRpc", async (method, params) => {
      return rpc(8545, method, params);
    });
    await page.exposeFunction("__mockDecrypt", async (blob, address) => {
      const addr = address.toLowerCase();
      const key = addr === a.toLowerCase() ? ACCOUNT_A.privateKey.slice(2) : ACCOUNT_B.privateKey.slice(2);
      const parsed = JSON.parse(blob);
      const result = decryptSafely({ encryptedData: parsed, privateKey: key });
      return "0x" + result;
    });
    await page.exposeFunction("__mockGetPubKey", async (address) => {
      const l = address.toLowerCase();
      if (l === a.toLowerCase()) return pubA;
      if (l === b.toLowerCase()) return pubB;
      throw new Error("Mock wallet has no encryption public key for " + address);
    });

    await page.addInitScript(
      ({ a, b, pubA, pubB }) => {
        window.__mockWallet = {
          connected: false,
          current: null,
          accounts: {
            [a.toLowerCase()]: { pub: pubA },
            [b.toLowerCase()]: { pub: pubB },
          },
          listeners: {},
        };
        const emit = (event, payload) => {
          for (const cb of window.__mockWallet.listeners[event] || []) {
            try {
              cb(payload);
            } catch (e) {
              console.error("listener error", e);
            }
          }
        };
        window.ethereum = {
          isMetaMask: true,
          on: (event, cb) => {
            window.__mockWallet.listeners[event] = window.__mockWallet.listeners[event] || [];
            window.__mockWallet.listeners[event].push(cb);
          },
          removeListener: (event, cb) => {
            window.__mockWallet.listeners[event] = (window.__mockWallet.listeners[event] || []).filter(
              (f) => f !== cb
            );
          },
          request: async ({ method, params = [] }) => {
            const w = window.__mockWallet;
            switch (method) {
              case "eth_requestAccounts": {
                if (!w.current) {
                  w.current = a;
                }
                w.connected = true;
                return [w.current];
              }
              case "eth_accounts":
                return w.connected ? [w.current] : [];
              case "eth_chainId":
                return "0x539";
              case "net_version":
                return "1337";
              case "eth_getEncryptionPublicKey":
                return w.accounts[params[0].toLowerCase()]?.pub || (await window.__mockGetPubKey(params[0]));
              case "eth_decrypt":
                return window.__mockDecrypt(params[0], params[1]);
              case "wallet_switchEthereumChain":
              case "wallet_addEthereumChain":
                return null;
              case "eth_sendTransaction":
                return window.__mockRpc(method, params);
              default:
                return window.__mockRpc(method, params);
            }
          },
        };
        window.__setMockAccount = (address) => {
          window.__mockWallet.connected = true;
          window.__mockWallet.current = address;
          emit("accountsChanged", [address]);
        };
      },
      { a, b, pubA, pubB }
    );

    // ---- TEST FLOW ---------------------------------------------------
    console.log("\n=== Scenario: connect wallet ===");
    await page.goto("http://127.0.0.1:5179", { waitUntil: "networkidle" });
    const connectBtn = page.getByRole("button", { name: "Connect Wallet" });
    try {
      await connectBtn.click({ timeout: 15000 });
    } catch (err) {
      const body = await page.evaluate(() => document.body.innerText.slice(0, 800));
      console.error("Connect button not clickable. Page body:\n", body);
      throw err;
    }
    await waitFor(
      () => page.getByText("Connected:").isVisible(),
      15000,
      300,
      "wallet connected"
    );
    const connectedText = await page.getByText(/Connected:/).first().textContent();
    check("wallet connects and shows address", connectedText.includes(a.slice(2, 6).toLowerCase()) || connectedText.includes("0x"), connectedText);

    // Upload
    console.log("\n=== Scenario: upload file ===");
    const fileInput = page.locator('input[type="file"]');
    try {
      await fileInput.setInputFiles({
        name: "verify-me.txt",
        mimeType: "text/plain",
        buffer: SAMPLE_FILE,
      });
    } catch (err) {
      const body = await page.evaluate(() => document.body.innerText.slice(0, 800));
      console.error("File input not found. Page body:\n", body);
      const html = await page.evaluate(() => document.body.innerHTML.slice(0, 500));
      console.error("HTML head:", html);
      throw err;
    }
    await page.getByRole("button", { name: "Encrypt & Upload" }).click();
    // Poll for either success (file card) or failure (error toast)
    const seen = new Set();
    let uploadResult = null;
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      const toasts = await page.locator(".toast").allTextContents();
      const errToast = toasts.find((t) => t.includes("failed"));
      if (errToast) {
        uploadResult = `ERROR: ${errToast}`;
        break;
      }
      for (const t of toasts) {
        if (!seen.has(t)) {
          seen.add(t);
          console.log("  [toast] " + t.slice(0, 120));
        }
      }
      if ((await page.locator(".file-card", { hasText: "verify-me.txt" }).count()) > 0) {
        uploadResult = "OK";
        break;
      }
    }
    check("file appears in My Files after on-chain registration", uploadResult === "OK", uploadResult);
    check("file appears in My Files after on-chain registration", true);
    const cidCell = await page.locator(".file-card", { hasText: "verify-me.txt" }).locator(".cid-cell").textContent();
    check("CID is shown and openable on a gateway", /Qm/.test(cidCell) && cidCell.includes("open"), cidCell);

    // Shared With Me empty for B
    console.log("\n=== Scenario: shared-with-me is empty for a stranger ===");
    await page.evaluate((addr) => window.__setMockAccount(addr), b);
    await waitFor(
      () => page.locator(".wallet-bar strong").textContent().then((t) => t.includes(b.slice(2, 6))),
      15000,
      300,
      "wallet switched to B"
    );
    await page.getByRole("button", { name: "Shared With Me" }).click();
    try {
      await waitFor(
        () => page.getByText(/No files have been shared with you yet/).isVisible(),
        20000,
        300,
        "empty shared list for B"
      );
    } catch (err) {
      const body = await page.evaluate(() => document.body.innerText.slice(0, 600));
      console.error("Shared list not empty. Body:\n", body);
      throw err;
    }
    check("account B sees empty 'Shared With Me' before grant", true);

    // Grant access A -> B
    console.log("\n=== Scenario: owner grants access to B ===");
    await page.evaluate((addr) => window.__setMockAccount(addr), a);
    await waitFor(
      () => page.locator(".wallet-bar strong").textContent().then((t) => t.includes(a.slice(2, 6))),
      15000,
      300,
      "wallet switched to A"
    );
    await page.getByRole("button", { name: "My Files" }).click();
    await waitForCard(page, "verify-me.txt", 30000, "file list for A");
    await page.locator(".file-card", { hasText: "verify-me.txt" }).getByRole("button", { name: "Share" }).click();
    await waitFor(() => page.locator(".modal").isVisible(), 5000, 200, "share modal");
    await page.locator(".modal input").first().fill(b);
    await page.getByRole("button", { name: "Grant access" }).click();
    await waitFor(
      () => page.getByText("Access granted").first().isVisible(),
      30000,
      400,
      "grant toast"
    );
    check("grantAccess succeeds via Share modal", true);
    await waitFor(() => page.evaluate(() => document.querySelectorAll(".modal").length === 0), 10000, 300, "modal closed");

    // B can now see + download + decrypt
    console.log("\n=== Scenario: B downloads and decrypts the shared file ===");
    await page.evaluate((addr) => window.__setMockAccount(addr), b);
    await waitFor(
      () => page.locator(".wallet-bar strong").textContent().then((t) => t.includes(b.slice(2, 6))),
      15000,
      300,
      "wallet switched to B"
    );
    await page.getByRole("button", { name: "Shared With Me" }).click();
    await waitForCard(page, "verify-me.txt", 30000, "shared file visible for B");
    check("file appears in B's Shared With Me after grant", true);

    const downloadPromise = page.waitForEvent("download", { timeout: 60000 });
    await page.locator(".file-card", { hasText: "verify-me.txt" }).getByRole("button", { name: "Download" }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const downloaded = Buffer.concat(chunks);
    check(
      "download contains the original plaintext after decrypt",
      downloaded.equals(SAMPLE_FILE),
      `got ${downloaded.length} bytes, expected ${SAMPLE_FILE.length}`
    );
    check("downloaded file name is correct", download.suggestedFilename() === "verify-me.txt", download.suggestedFilename());

    // Revoke access
    console.log("\n=== Scenario: owner revokes B's access ===");
    await page.evaluate((addr) => window.__setMockAccount(addr), a);
    await waitFor(
      () => page.locator(".wallet-bar strong").textContent().then((t) => t.includes(a.slice(2, 6))),
      15000,
      300,
      "wallet switched to A"
    );
    await page.getByRole("button", { name: "My Files" }).click();
    await waitForCard(page, "verify-me.txt", 30000, "file list for A");
    await page.locator(".file-card", { hasText: "verify-me.txt" }).getByRole("button", { name: "Manage access" }).click();
    await waitFor(() => page.locator(".modal").isVisible(), 5000, 200, "manage modal");
    await page.locator(".modal .grants-table tr", { hasText: b.slice(2, 6) }).getByRole("button", { name: "Revoke" }).click();
    await waitFor(
      () => page.getByText("Access revoked").first().isVisible(),
      30000,
      400,
      "revoke toast"
    );
    check("revokeAccess succeeds via Manage Access modal", true);
    await page.getByRole("button", { name: "Close" }).click();

    // B loses access
    console.log("\n=== Scenario: B loses access after revocation ===");
    await page.evaluate((addr) => window.__setMockAccount(addr), b);
    await waitFor(
      () => page.locator(".wallet-bar strong").textContent().then((t) => t.includes(b.slice(2, 6))),
      15000,
      300,
      "wallet switched to B"
    );
    await page.getByRole("button", { name: "Shared With Me" }).click();
    await waitFor(
      () => page.getByText(/No files have been shared with you yet/).isVisible() ||
        page.locator(".file-card", { hasText: "verify-me.txt" }).count() === 0,
      20000,
      400,
      "shared list empty for B after revoke"
    );
    check("file disappears from B's Shared With Me after revocation", true);

    // Expiry test: grant with short expiry, then time-travel on the node
    console.log("\n=== Scenario: expiring access ===");
    await page.evaluate((addr) => window.__setMockAccount(addr), a);
    await waitFor(
      () => page.locator(".wallet-bar strong").textContent().then((t) => t.includes(a.slice(2, 6))),
      15000,
      300,
      "wallet switched to A"
    );
    await page.getByRole("button", { name: "My Files" }).click();
    await waitForCard(page, "verify-me.txt", 30000, "file list for A");
    await page.locator(".file-card", { hasText: "verify-me.txt" }).getByRole("button", { name: "Share" }).click();
    await waitFor(() => page.locator(".modal").isVisible(), 5000, 200, "share modal");
    await page.locator(".modal input").first().fill(b);
    const expiryLocal = new Date(Date.now() + 5 * 60 * 1000);
    const fmt = (d) => {
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    await page.locator('.modal input[type="datetime-local"]').fill(fmt(expiryLocal));
    await page.getByRole("button", { name: "Grant access" }).click();
    await waitFor(
      () => page.getByText("Access granted").first().isVisible(),
      30000,
      400,
      "expiry grant toast"
    );
    check("grant with future expiry succeeds", true);

    // Advance node time past the expiry and mine a block
    await rpc(8545, "evm_increaseTime", [6 * 60 * 60]);
    await rpc(8545, "evm_mine");

    await page.evaluate((addr) => window.__setMockAccount(addr), b);
    await waitFor(
      () => page.locator(".wallet-bar strong").textContent().then((t) => t.includes(b.slice(2, 6))),
      15000,
      300,
      "wallet switched to B"
    );
    await page.getByRole("button", { name: "Shared With Me" }).click();
    await waitFor(
      () => page.getByText(/No files have been shared with you yet/).isVisible(),
      20000,
      400,
      "expired file hidden for B"
    );
    check("expired grant no longer grants access (file hidden)", true);

    // Activity log (from the owner's perspective so all event types appear)
    console.log("\n=== Scenario: on-chain activity log ===");
    await page.evaluate((addr) => window.__setMockAccount(addr), a);
    await waitFor(
      () => page.locator(".wallet-bar strong").textContent().then((t) => t.includes(a.slice(2, 6))),
      15000,
      300,
      "wallet switched to A"
    );
    await page.getByRole("button", { name: "Activity Log" }).click();
    await waitFor(
      () => page.evaluate(() => document.querySelectorAll(".activity-item").length >= 4),
      30000,
      500,
      "activity items"
    );
    const activityText = await page.locator(".activity-list").textContent();
    const hasUpload = activityText.includes("Uploaded");
    const hasGrant = activityText.includes("Granted access");
    const hasRevoke = activityText.includes("Revoked access");
    check("activity log lists Uploaded events", hasUpload);
    check("activity log lists Granted events", hasGrant);
    check("activity log lists Revoked events", hasRevoke);
    const firstLink = await page.locator(".activity-item a", { hasText: "Etherscan" }).first().getAttribute("href");
    check("activity entries link to Etherscan", /etherscan|explorer/.test(firstLink || ""), firstLink || "");

    await browser.close();
  } finally {
    cleanupProcs();
  }

  console.log("\n==============================================");
  if (failures === 0) {
    console.log("ALL UI VERIFICATION CHECKS PASSED");
  } else {
    console.error(`${failures} UI VERIFICATION CHECK(S) FAILED`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nFATAL:", err.message);
  cleanupProcs();
  process.exit(1);
});
