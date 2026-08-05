import { createContext, useContext, useCallback, useRef, useState } from "react";

const ToastContext = createContext(null);

export function useToasts() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts must be used within ToastProvider");
  return ctx;
}

let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
  }, []);

  const show = useCallback(
    ({ type = "info", title = "", message = "", txHash = null, autoDismiss = 5000 }) => {
      const id = ++nextId;
      setToasts((prev) => [...prev, { id, type, title, message, txHash }]);
      if (autoDismiss > 0 && type !== "loading") {
        timers.current[id] = setTimeout(() => dismiss(id), autoDismiss);
      }
      return id;
    },
    [dismiss]
  );

  const update = useCallback((id, patch) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  /**
   * Watch a transaction promise and reflect its lifecycle in a toast:
   * pending -> confirmed -> success (auto-dismiss), or failed.
   */
  const watchTransaction = useCallback(
    async (txPromise, { title = "Transaction", successTitle, errorTitle } = {}) => {
      const id = show({ type: "loading", title: `${title} submitted...`, message: "Waiting for confirmation on the blockchain." });
      try {
        const tx = await txPromise;
        update(id, { message: `Waiting for confirmation (hash: ${shortHash(tx.hash)})...` });
        const receipt = await tx.wait();
        update(id, {
          type: "success",
          title: successTitle || `${title} confirmed`,
          message: `Confirmed in block #${receipt.blockNumber}`,
          txHash: tx.hash,
        });
        setTimeout(() => dismiss(id), 6000);
        return { tx, receipt };
      } catch (err) {
        update(id, {
          type: "error",
          title: errorTitle || `${title} failed`,
          message: err?.reason || err?.info?.error?.message || err?.message || "Unknown error",
          txHash: err?.transactionHash || null,
          autoDismiss: 0,
        });
        setTimeout(() => dismiss(id), 9000);
        throw err;
      }
    },
    [show, update, dismiss]
  );

  const value = { toasts, show, update, dismiss, watchTransaction };
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

function shortHash(hash) {
  if (!hash) return "";
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}
