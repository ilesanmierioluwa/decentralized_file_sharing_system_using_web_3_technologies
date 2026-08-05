/**
 * TransactionStatusToast (Module 10): global toast stack that renders
 * transaction status notifications (pending / confirmed / failed) plus any
 * info/error/success toasts from the app.
 */
import { useToasts } from "../context/ToastContext";
import { txUrl } from "../config";

export default function TransactionStatusToast() {
  const { toasts, dismiss } = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`} onClick={() => t.type !== "loading" && dismiss(t.id)}>
          {t.type === "loading" ? (
            <span className="spinner" />
          ) : (
            <span className="toast-icon">{t.type === "success" ? "✓" : t.type === "error" ? "✗" : "ℹ"}</span>
          )}
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.message && <div className="toast-message">{t.message}</div>}
            {t.txHash && (
              <a className="toast-link" href={txUrl(t.txHash)} target="_blank" rel="noreferrer">
                View transaction ↗
              </a>
            )}
          </div>
          {t.type !== "loading" && (
            <button className="toast-close" onClick={() => dismiss(t.id)}>✕</button>
          )}
        </div>
      ))}
    </div>
  );
}
