/**
 * DownloadButton (Module 9): runs the full authorized download pipeline with
 * per-step status feedback, surfaced through toasts.
 */
import { useState } from "react";
import { useToasts } from "../context/ToastContext";
import { downloadAndDecryptFile } from "../services/accessService";

export default function DownloadButton({ file, account, onDone }) {
  const { show, update } = useToasts();
  const [busy, setBusy] = useState(false);

  const handleDownload = async () => {
    if (busy) return;
    setBusy(true);
    let toastId = null;
    try {
      await downloadAndDecryptFile(file, account, {
        onStatus: (step) => {
          if (!toastId) {
            toastId = show({ type: "loading", title: "Downloading...", message: step || "Working...", autoDismiss: 0 });
          } else if (step) {
            update(toastId, { message: step });
          }
        },
      });
      show({
        type: "success",
        title: "Downloaded & decrypted",
        message: `"${file.fileName}" is decrypted and saved to your downloads.`,
        autoDismiss: 6000,
      });
      onDone?.();
    } catch (err) {
      show({
        type: "error",
        title: "Download failed",
        message: err?.message || "An unexpected error occurred.",
        autoDismiss: 9000,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="btn btn-primary btn-sm" onClick={handleDownload} disabled={busy}>
      {busy ? "Working..." : "Download"}
    </button>
  );
}
