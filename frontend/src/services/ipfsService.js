import { config } from "../config";

/**
 * IPFS service (Module 6).
 *
 * Uploads encrypted blobs to IPFS via Pinata's pinning API, and fetches blobs
 * back from public IPFS gateways with automatic gateway fallback.
 *
 * If Pinata is not configured (no VITE_PINATA_JWT) but a local IPFS-compatible
 * dev server is (VITE_LOCAL_IPFS_URL), uploads go there instead. This lets the
 * app be developed/tested without external credentials.
 */

const PINATA_API = "https://api.pinata.cloud/pinning/pinFileToIPFS";

/**
 * Upload an encrypted file blob to IPFS.
 * @param {ArrayBuffer|Blob} blob encrypted file bytes
 * @param {string} fileName
 * @returns {Promise<string>} the IPFS Content Identifier (CID)
 */
export async function uploadToIPFS(blob, fileName) {
  if (config.pinataJwt) {
    return uploadToPinata(blob, fileName);
  }
  if (config.localIpfsUrl) {
    return uploadToLocal(blob, fileName);
  }
  throw new Error(
    "IPFS upload is not configured. Set VITE_PINATA_JWT (frontend/.env) to use Pinata."
  );
}

/** Upload a blob to Pinata using the pinFileToIPFS endpoint. */
async function uploadToPinata(blob, fileName) {
  const formData = new FormData();
  formData.append("file", new Blob([blob], { type: "application/octet-stream" }), fileName);

  let response;
  try {
    response = await fetch(PINATA_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.pinataJwt}` },
      body: formData,
    });
  } catch (err) {
    throw new Error(
      "Failed to reach Pinata. Check your internet connection and Pinata API key."
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      const data = await response.json();
      detail = data?.error?.details || data?.message || "";
    } catch {
      /* ignore parse errors */
    }
    throw new Error(
      `Failed to pin file to IPFS (HTTP ${response.status})${detail ? `: ${detail}` : ""}. ` +
        "Check your Pinata API key."
    );
  }

  const data = await response.json();
  if (!data.IpfsHash) {
    throw new Error("Pinata responded without an IpfsHash.");
  }
  return data.IpfsHash;
}

/** Upload a blob to the local dev IPFS-compatible server. */
async function uploadToLocal(blob, fileName) {
  let response;
  try {
    response = await fetch(`${config.localIpfsUrl}/upload?fileName=${encodeURIComponent(fileName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: blob,
    });
  } catch (err) {
    throw new Error(
      `Failed to reach the local IPFS dev server at ${config.localIpfsUrl}. ` +
        "Start it or set VITE_PINATA_JWT to use Pinata."
    );
  }

  if (!response.ok) {
    throw new Error(`Local IPFS upload failed (HTTP ${response.status}).`);
  }

  const data = await response.json();
  if (!data.cid) {
    throw new Error("Local IPFS server responded without a cid.");
  }
  return data.cid;
}

/**
 * Fetch an encrypted blob from IPFS by CID (with gateway fallback).
 * @param {string} cid
 * @returns {Promise<ArrayBuffer>}
 */
export async function fetchFromIPFS(cid) {
  const gateways = [];
  if (config.localIpfsUrl) {
    gateways.push(`${config.localIpfsUrl}/ipfs/`);
  }
  for (const g of config.gateways.length
    ? config.gateways
    : ["https://ipfs.io/ipfs/", "https://gateway.pinata.cloud/ipfs/"]) {
    gateways.push(g);
  }

  let lastError = null;
  for (const gateway of gateways) {
    const url = `${gateway.replace(/\/$/, "")}/${cid}`;
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.arrayBuffer();
      }
      lastError = new Error(`Gateway responded with HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `File not found on IPFS gateways. Tried: ${gateways.join(", ")}. ` +
      `Last error: ${lastError?.message || "unknown"}`
  );
}
