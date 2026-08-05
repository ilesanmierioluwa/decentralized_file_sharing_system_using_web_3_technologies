import {
  getEncryptedKeyFor,
  hasAccess,
} from "./contractService";
import {
  getEncryptionPublicKey,
  encryptKeyForRecipient,
  decryptKeyForRecipient,
  importFileKey,
  decryptFile,
} from "./encryptionService";
import { fetchFromIPFS } from "./ipfsService";
import { triggerDownload } from "../utils/fileUtils";

/**
 * High-level access flows shared by MyFiles and SharedWithMe:
 *
 *  - prepareGrantBlob:  owner decrypts their own file key (wallet), then
 *    re-encrypts it to the grantee's encryption public key.
 *  - downloadAndDecryptFile: the full authorized download pipeline with
 *    step-by-step status feedback (Module 9).
 */

/**
 * Build the encrypted-key blob for a grantee.
 * @param {number} fileId
 * @param {string} grantee address to share with
 * @param {{manualPublicKey?: string}} opts pass the grantee's public key to
 *        skip the wallet prompt (e.g. cross-wallet sharing out-of-band).
 * @param {string} ownerAccount the connected owner address
 * @returns {Promise<string>} encrypted key blob for the grantee
 */
export async function prepareGrantBlob(fileId, grantee, opts = {}, ownerAccount) {
  const ownerBlob = await getEncryptedKeyFor(fileId, ownerAccount);
  if (!ownerBlob) {
    throw new Error("You have no decryption key for this file. Re-upload the file to restore your key.");
  }

  const rawKeyBytes = await decryptKeyForRecipient(ownerBlob, ownerAccount);

  const publicKey = opts.manualPublicKey
    ? opts.manualPublicKey.replace(/^0x/, "")
    : await getEncryptionPublicKey(grantee);

  return encryptKeyForRecipient(publicKey, rawKeyBytes);
}

/**
 * Download, decrypt and save a file to disk.
 * @param {object} file File record from the contract
 * @param {string} account the connected wallet address
 * @param {{onStatus?: (step: string) => void}} callbacks
 */
export async function downloadAndDecryptFile(file, account, { onStatus } = {}) {
  const status = (s) => onStatus?.(s);

  status("Checking access on-chain...");
  const ok = await hasAccess(file.id, account);
  if (!ok) {
    throw new Error("Access denied: the smart contract does not permit you to retrieve this file.");
  }

  status("Fetching your decryption key from the chain...");
  const keyBlob = await getEncryptedKeyFor(file.id, account);
  if (!keyBlob) {
    throw new Error("No decryption key available for your wallet on this file.");
  }

  status("Decrypting your file key (approve in your wallet if prompted)...");
  const rawKeyBytes = await decryptKeyForRecipient(keyBlob, account);
  const key = await importFileKey(rawKeyBytes);

  status("Fetching the encrypted file from IPFS...");
  const combined = await fetchFromIPFS(file.cid);

  status("Decrypting the file locally...");
  const bytes = new Uint8Array(combined);
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  const plaintext = await decryptFile(ciphertext, key, iv);

  status("Downloading the decrypted file...");
  triggerDownload(plaintext, file.fileName);
  status("");
}
