/**
 * Shared With Me page (Module 9): lists files other wallets have shared with
 * the connected account, with the authorized download/decrypt flow.
 */
import { useCallback, useEffect, useState } from "react";
import { getFilesSharedWithMe, getFile, hasAccess } from "../services/contractService";
import DownloadButton from "./DownloadButton";
import { formatBytes, formatDate, shortAddress } from "../utils/fileUtils";

export default function SharedWithMe({ account }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const ids = await getFilesSharedWithMe();
      const list = [];
      for (const id of ids) {
        const f = await getFile(id);
        // Only show active files the contract currently allows us to access.
        const canAccess = await hasAccess(id, account);
        if (f.isActive && canAccess) list.push(f);
      }
      setFiles(list);
    } catch (err) {
      setError(err?.message || "Failed to load shared files.");
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    if (account) load();
  }, [account, load]);

  return (
    <section>
      <div className="section-head">
        <h2>Shared With Me</h2>
        <button className="btn btn-secondary btn-sm" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}
      {loading && <p className="muted">Loading files shared with you…</p>}

      {!loading && files.length === 0 && !error && (
        <p className="muted">
          No files have been shared with you yet. When someone grants you access, the file will appear here.
        </p>
      )}

      <div className="file-grid">
        {files.map((f) => (
          <div className="card file-card" key={f.id}>
            <div className="file-card-head">
              <span className="file-type-badge">{f.fileType || "file"}</span>
              <span className="file-id mono">#{f.id}</span>
            </div>
            <h4 title={f.fileName}>{f.fileName}</h4>
            <ul className="meta-list">
              <li><span>Size</span> {formatBytes(f.fileSize)}</li>
              <li><span>Shared by</span> {shortAddress(f.owner)}</li>
              <li><span>Uploaded</span> {formatDate(f.uploadedAt)}</li>
            </ul>
            <div className="file-actions">
              <DownloadButton file={f} account={account} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
