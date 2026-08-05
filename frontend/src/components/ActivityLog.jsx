/**
 * Activity Log page (Module 10): an on-chain audit trail powered entirely by
 * blockchain events (FileUploaded / AccessGranted / AccessRevoked) — no
 * central logging database is involved.
 */
import { useCallback, useEffect, useState } from "react";
import { getActivityFeed, getFile } from "../services/contractService";
import { txUrl } from "../config";
import { formatDate, shortAddress } from "../utils/fileUtils";

export default function ActivityLog({ account }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [names, setNames] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const feed = await getActivityFeed(0, account);
      setItems(feed);

      // Resolve file names for friendlier messages (with a small cache).
      const missing = [...new Set(feed.map((i) => i.fileId))].filter((id) => !(id in names));
      const nameMap = { ...names };
      await Promise.all(
        missing.map(async (id) => {
          try {
            const f = await getFile(id);
            nameMap[id] = f.fileName;
          } catch {
            nameMap[id] = `File #${id}`;
          }
        })
      );
      setNames(nameMap);
    } catch (err) {
      setError(err?.message || "Failed to load the activity log.");
    } finally {
      setLoading(false);
    }
  }, [account]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (account) load();
  }, [account, load]);

  const icon = (type) => (type === "uploaded" ? "⬆" : type === "granted" ? "➜" : "✖");

  return (
    <section>
      <div className="section-head">
        <h2>Activity Log</h2>
        <button className="btn btn-secondary btn-sm" onClick={load}>
          Refresh
        </button>
      </div>
      <p className="muted">
        This feed is sourced directly from blockchain events on the contract —
        there is no central database. Each entry links to its transaction.
      </p>

      {error && <div className="form-error">{error}</div>}
      {loading && <p className="muted">Loading on-chain activity…</p>}

      {!loading && items.length === 0 && !error && (
        <p className="muted">No activity found for this wallet yet.</p>
      )}

      <ul className="activity-list">
        {items.map((item, idx) => {
          const name = names[item.fileId] || `File #${item.fileId}`;
          let text = "";
          if (item.type === "uploaded") {
            text = <>Uploaded <strong>{name}</strong></>;
          } else if (item.type === "granted") {
            text = (
              <>
                Granted access to <strong className="mono">{shortAddress(item.other, 10)}</strong> for{" "}
                <strong>{name}</strong>
              </>
            );
          } else {
            text = (
              <>
                Revoked access from <strong className="mono">{shortAddress(item.other, 10)}</strong> for{" "}
                <strong>{name}</strong>
              </>
            );
          }
          return (
            <li className={`activity-item activity-${item.type}`} key={item.txHash + idx}>
              <span className="activity-icon">{icon(item.type)}</span>
              <div className="activity-body">
                <div>{text}</div>
                <div className="muted small">
                  {formatDate(item.timestamp)} · block {item.blockNumber}
                  {item.type === "uploaded" && item.cid ? ` · CID ${shortAddress(item.cid, 10)}` : ""}
                </div>
              </div>
              <a className="btn btn-secondary btn-sm" href={txUrl(item.txHash)} target="_blank" rel="noreferrer">
                View on Etherscan ↗
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
