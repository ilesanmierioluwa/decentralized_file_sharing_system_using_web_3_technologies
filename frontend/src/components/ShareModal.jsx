/**
 * ShareModal (Module 8): grants another wallet access to a file.
 * The owner's file key is decrypted in their wallet, re-encrypted to the
 * grantee's encryption public key, and the resulting ciphertext is submitted
 * on-chain with grantAccess.
 */
import { useState } from "react";
import { useToasts } from "../context/ToastContext";
import { grantAccess } from "../services/contractService";
import { getEncryptionPublicKey } from "../services/encryptionService";
import { prepareGrantBlob } from "../services/accessService";
import { isValidAddress } from "../utils/fileUtils";

export default function ShareModal({ file, account, onClose, onShared }) {
  const { show, watchTransaction } = useToasts();
  const [grantee, setGrantee] = useState("");
  const [expiry, setExpiry] = useState("");
  const [manualPublicKey, setManualPublicKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setError("");
    if (!isValidAddress(grantee)) {
      setError("Enter a valid wallet address (0x + 40 hex characters).");
      return;
    }
    if (grantee.toLowerCase() === account.toLowerCase()) {
      setError("You already have access as the file owner.");
      return;
    }
    setBusy(true);
    try {
      let expiresAt = 0;
      if (expiry) {
        const ms = new Date(expiry).getTime();
        if (isNaN(ms) || ms <= Date.now()) {
          setError("Expiry must be a future date and time.");
          setBusy(false);
          return;
        }
        expiresAt = Math.floor(ms / 1000);
      }

      show({ type: "loading", title: "Preparing encrypted key...", message: "Decrypting and re-encrypting your file key." });
      const encryptedKeyBlob = await prepareGrantBlob(file.id, grantee, { manualPublicKey }, account);

      if (!manualPublicKey) {
        // Warm-up the encryption public key request so the user approves it
        // before the on-chain transaction.
        try {
          await getEncryptionPublicKey(grantee);
        } catch (err) {
          throw new Error(
            "Could not get the grantee's encryption public key from this wallet. " +
              "Ask them for it and paste it in the optional field, or grant from a browser where their wallet is available."
          );
        }
      }

      show({ type: "loading", title: "Submitting access grant...", message: `Granting access to ${grantee.slice(0, 10)}...` });
      await watchTransaction(
        grantAccess(file.id, grantee, encryptedKeyBlob, expiresAt),
        { title: "Access grant", successTitle: "Access granted" }
      );

      show({
        type: "success",
        title: "Access granted",
        message: `${grantee.slice(0, 6)}...${grantee.slice(-4)} can now download "${file.fileName}".`,
        autoDismiss: 6000,
      });
      onShared?.();
      onClose();
    } catch (err) {
      show({
        type: "error",
        title: "Grant failed",
        message: err?.reason || err?.message || "An unexpected error occurred.",
        autoDismiss: 9000,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Share "{file.fileName}"</h3>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>

        <label className="field">
          <span>Grantee wallet address</span>
          <input
            value={grantee}
            onChange={(e) => setGrantee(e.target.value.trim())}
            placeholder="0x..."
            spellCheck="false"
          />
        </label>

        <label className="field">
          <span>Access expiry (optional)</span>
          <input
            type="datetime-local"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          />
        </label>

        <details className="field">
          <summary>Optional: grantee's encryption public key (for cross-wallet sharing)</summary>
          <input
            value={manualPublicKey}
            onChange={(e) => setManualPublicKey(e.target.value.trim())}
            placeholder="If the grantee is on another browser, paste their key here"
            spellCheck="false"
          />
        </details>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={busy}>
            {busy ? "Working..." : "Grant access"}
          </button>
        </div>
      </div>
    </div>
  );
}
