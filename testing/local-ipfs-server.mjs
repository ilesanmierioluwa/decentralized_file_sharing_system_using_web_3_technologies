/**
 * Local IPFS-compatible dev server for testing without Pinata.
 * Not part of the deliverable — a convenience so the whole app can be
 * exercised end-to-end locally (upload -> pin -> fetch by CID).
 */
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 9099);
const store = new Map(); // cid -> Buffer

const B58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

function toBase58(buf) {
  let digits = [0];
  for (const byte of buf) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const d of digits) out = B58_ALPHABET[d] + out;
  // pad with '1's for leading zero bytes
  for (const byte of buf) {
    if (byte === 0) out = "1" + out;
    else break;
  }
  return out;
}

/** Build a CIDv0: multihash = 0x12 0x20 + sha256, base58. */
function makeCid(buf) {
  const mh = Buffer.concat([Buffer.from([0x12, 0x20]), sha256(buf)]);
  return "Qm" + toBase58(mh);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    res.end();
    return;
  }

  // Upload
  if (req.method === "POST" && url.pathname === "/upload") {
    try {
      const body = await readBody(req);
      const cid = makeCid(body);
      store.set(cid, body);
      console.log(`[local-ipfs] pinned ${cid} (${body.length} bytes)`);
      sendJson(res, 200, { cid });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // Fetch by CID
  if (req.method === "GET" && url.pathname.startsWith("/ipfs/")) {
    const cid = url.pathname.replace("/ipfs/", "");
    const data = store.get(cid);
    if (!data) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Content-Length": data.length,
    });
    res.end(data);
    return;
  }

  // Health check
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, pins: store.size });
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`[local-ipfs] listening on http://127.0.0.1:${PORT}`);
});
