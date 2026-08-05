/**
 * File upload component (Module 8).
 * Encrypts the file client-side (AES-256-GCM), uploads the ciphertext to IPFS,
 * registers the CID + metadata on-chain, then grants the owner access to their
 * own file key so downloading works uniformly for owner and grantees.
 */
import { useRef, useState } from "react";
import { useToasts } from "../context/ToastContext";
import {
  generateFileKey,
  exportFileKey,
  encryptFile,
  getEncryptionPublicKey,
  encryptKeyForRecipient,
} from "../services/encryptionService";
import { uploadToIPFS } from "../services/ipfsService";
import { uploadFile as contractUploadFile, grantAccess, getContract } from "../services/contractService";

export default function FileUpload({ account, onUploaded }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const { show, watchTransaction } = useToasts();

  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    setFile(f || null);
  };

  const handleUpload = async () => {
    if (!file) {
      show({ type: "error", title: "No file selected", message: "Pick a file to upload." });
      return;
    }
    setBusy(true);
    try {
      show({ type: "loading", title: "Encrypting file...", message: "Generating AES-256-GCM key and encrypting client-side." });

      const key = await generateFileKey();
      const rawKeyBytes = await exportFileKey(key);
      const fileBytes = await file.arrayBuffer();
      const { ciphertext, iv } = await encryptFile(fileBytes, key);

      // Bundle iv + ciphertext so a single IPFS blob is self-describing.
      const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(ciphertext), iv.byteLength);

      show({ type: "loading", title: "Uploading to IPFS...", message: "Pinning the encrypted blob via Pinata." });
      const cid = await uploadToIPFS(combined.buffer, file.name);
      show({ type: "info", title: "Encrypted blob on IPFS", message: `CID: ${cid}`, autoDismiss: 4000 });

      show({ type: "loading", title: "Registering on-chain...", message: "Calling uploadFile on the FileRegistry contract." });
      const { receipt } = await watchTransaction(
        contractUploadFile(cid, file.name, file.type || "application/octet-stream", combined.byteLength),
        { title: "File registration", successTitle: "File registered on-chain" }
      );
      const fileId = Number(await findUploadedFileId(receipt.logs));
      void fileId;

      // Grant the owner access to their own file key (uniform decrypt path).
      show({ type: "loading", title: "Securing your decryption key...", message: "Encrypting the file key to your wallet." });
      const ownerPublicKey = await getEncryptionPublicKey(account);
      const ownerKeyBlob = await encryptKeyForRecipient(ownerPublicKey, rawKeyBytes);

      show({ type: "loading", title: "Granting owner access...", message: "Submitting self-grant on-chain." });
      await watchTransaction(
        grantAccess(fileId, account, ownerKeyBlob, 0),
        { title: "Owner access grant", successTitle: "Owner access granted" }
      );

      show({
        type: "success",
        title: "Upload complete",
        message: `"${file.name}" is encrypted, pinned on IPFS, and registered on-chain.`,
        autoDismiss: 6000,
      });

      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      onUploaded?.();
    } catch (err) {
      show({
        type: "error",
        title: "Upload failed",
        message: err?.message || "An unexpected error occurred.",
        autoDismiss: 9000,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card upload-card">
      <h3>Upload a File</h3>
      <p className="muted">
        Your file is encrypted with AES-256-GCM <em>before</em> it leaves your
        browser. Only the encrypted bytes are pinned to IPFS; only you and
        people you grant access to can decrypt it.
      </p>
      <div className="upload-row">
        <label className="btn btn-secondary file-pick">
          {file ? "Change file" : "Choose file"}
          <input ref={inputRef} type="file" onChange={onFileChange} disabled={busy} />
        </label>
        {file && (
          <span className="file-name" title={file.name}>
            {file.name} ({(file.size / 1024).toFixed(1)} KB)
          </span>
        )}
        <button className="btn btn-primary" onClick={handleUpload} disabled={busy || !file}>
          {busy ? "Working..." : "Encrypt & Upload"}
        </button>
      </div>
    </div>
  );
}

/** Extract the emitted file id from an uploadFile receipt. */
async function findUploadedFileId(logs) {
  // The contract emits FileUploaded(fileId, owner, cid, ts) — fileId is the
  // first indexed topic. We fall back to fileCount if parsing fails.
  for (const log of logs || []) {
    try {
      if (log.topics?.length >= 2) {
        const big = BigInt(log.topics[1]);
        if (big > 0n) return big.toString();
      }
    } catch {
      /* skip */
    }
  }
  const c = getContract();
  const count = await c.fileCount();
  return Number(count);
}
