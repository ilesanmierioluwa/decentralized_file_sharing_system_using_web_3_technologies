import nacl from "tweetnacl";
import { base64, utf8 } from "@scure/base";

/**
 * Client-side encryption service (Module 5).
 *
 *  - Files are encrypted with AES-256-GCM using the browser's Web Crypto API
 *    before they ever leave the machine.
 *  - The random AES key is itself encrypted to a recipient's wallet using the
 *    wallet-native curve25519-xsalsa20-poly1305 (NaCl box) ECIES scheme:
 *      * encryption:  `eth_getEncryptionPublicKey` (base64 x25519 public key)
 *                     + a local NaCl-box implementation that matches the
 *                     @metamask/eth-sig-util ciphertext format.
 *      * decryption:  MetaMask's `eth_decrypt` RPC (the raw private key never
 *        leaves the wallet).
 *    This implements the guide's Approach A (Section 2.3): only the grantee's
 *    wallet can decrypt the AES key, and only the ciphertext of the key is
 *    ever stored on-chain / on IPFS.
 */

/** Generate a random AES-256-GCM key. */
export async function generateFileKey() {
  return window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

/** Export a CryptoKey to its raw 32-byte representation. */
export async function exportFileKey(key) {
  return window.crypto.subtle.exportKey("raw", key);
}

/** Import raw key bytes back into an AES-GCM CryptoKey. */
export async function importFileKey(rawKeyBytes) {
  return window.crypto.subtle.importKey(
    "raw",
    rawKeyBytes,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"]
  );
}

/** Encrypt an ArrayBuffer with AES-256-GCM. Returns { ciphertext, iv }. */
export async function encryptFile(fileBytes, key) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    fileBytes
  );
  return { ciphertext, iv };
}

/** Decrypt an AES-256-GCM ciphertext. Returns an ArrayBuffer. */
export async function decryptFile(ciphertext, key, iv) {
  return window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
}

/* ------------------------------------------------------------------ */
/* Key sharing (Approach A): encrypt the AES key to a recipient wallet */
/* ------------------------------------------------------------------ */

/** Get a wallet's encryption public key via eth_getEncryptionPublicKey. */
export async function getEncryptionPublicKey(account) {
  if (!window.ethereum?.request) {
    throw new Error("No Web3 wallet detected (MetaMask)");
  }
  const publicKey = await window.ethereum.request({
    method: "eth_getEncryptionPublicKey",
    params: [account],
  });
  if (!publicKey) {
    throw new Error("Wallet returned an empty encryption public key");
  }
  // MetaMask returns a base64-encoded x25519 public key.
  return publicKey.startsWith("0x") ? publicKey.slice(2) : publicKey;
}

/**
 * Encrypt the raw AES key to a recipient's encryption public key.
 * Produces the same ciphertext format as @metamask/eth-sig-util (and hence
 * compatible with MetaMask's eth_decrypt).
 *
 * @param {string} recipientPublicKey base64 x25519 public key
 * @param {ArrayBuffer|Uint8Array|string} keyData raw AES key bytes (or hex)
 * @returns {Promise<string>} JSON ciphertext blob safe to store on-chain
 */
export async function encryptKeyForRecipient(recipientPublicKey, keyData) {
  const hexKey = keyData instanceof Uint8Array || keyData instanceof ArrayBuffer
    ? bytesToHex(new Uint8Array(keyData))
    : keyData;

  // Mirror @metamask/eth-sig-util's encryptSafely: wrap in {data, padding}
  // JSON so the plaintext survives MetaMask's decryptSafely, which returns
  // the `.data` field of this JSON.
  const DEFAULT_PADDING_LENGTH = 2 ** 11;
  const NACL_EXTRA_BYTES = 16;
  const withPadding = { data: hexKey, padding: "" };
  const modVal =
    utf8.decode(JSON.stringify(withPadding)).length % DEFAULT_PADDING_LENGTH;
  let padLength = 0;
  if (modVal > 0) {
    padLength = DEFAULT_PADDING_LENGTH - modVal - NACL_EXTRA_BYTES;
  }
  withPadding.padding = "0".repeat(padLength);
  const paddedMessage = JSON.stringify(withPadding);

  const ephemeralKeyPair = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(
    utf8.decode(paddedMessage),
    nonce,
    base64.decode(recipientPublicKey),
    ephemeralKeyPair.secretKey
  );

  return JSON.stringify({
    version: "x25519-xsalsa20-poly1305",
    nonce: base64.encode(nonce),
    ephemPublicKey: base64.encode(ephemeralKeyPair.publicKey),
    ciphertext: base64.encode(ciphertext),
  });
}

/**
 * Decrypt an encrypted-key blob using the connected wallet's `eth_decrypt`.
 * @param {string} encryptedBlob the JSON ciphertext blob from the contract
 * @param {string} account the connected wallet address
 * @returns {Promise<ArrayBuffer>} raw AES key bytes
 */
export async function decryptKeyForRecipient(encryptedBlob, account) {
  if (!window.ethereum?.request) {
    throw new Error("No Web3 wallet detected (MetaMask)");
  }
  const result = await window.ethereum.request({
    method: "eth_decrypt",
    params: [encryptedBlob, account],
  });
  if (!result) {
    throw new Error("eth_decrypt returned an empty result");
  }
  return hexToBytes(result);
}

/** Convert bytes to a lowercase hex string. */
export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Convert a hex string to a Uint8Array. */
function hexToBytes(hex) {
  let clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) clean = "0" + clean;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
