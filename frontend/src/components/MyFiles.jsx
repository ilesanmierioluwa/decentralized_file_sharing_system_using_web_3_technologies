/**
 * My Files page (Module 8): lists files owned by the connected wallet with
 * download, share, manage-access and IPFS/CID actions.
 */
import { useCallback, useEffect, useState } from "react";
import { getMyFiles, getFile } from "../services/contractService";
import { useToasts } from "../context/ToastContext";
import DownloadButton from "./DownloadButton";
import ShareModal from "./ShareModal";
import ManageAccess from "./ManageAccess";
import { formatBytes, formatDate, shortAddress } from "../utils/fileUtils";
import { cidUrl, txUrl } from "../config";

export default function MyFiles({ account, reloadToken = 0 }) {
  const { show } = useToasts();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [shareFile, setShareFile] = useState(null);
  const [manageFile, setManageFile] = useState(null);
  const [copiedCid, setCopiedCid] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const ids = await getMyFiles();
      const list = [];
      for (const id of ids) {
        const f = await getFile(id);
        if (f.isActive) list.push(f);
      }
      setFiles(list);
    } catch (err) {
      setError(err?.message || "Failed to load your files.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (account) load();
  }, [account, load, reloadToken]);

  const copyCid = async (e, cid) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(cid);
      setCopiedCid(cid);
      setTimeout(() => setCopiedCid(null), 2000);
    } catch {
      show({ type: "error", title: "Copy failed", message: "Clipboard unavailable." });
    }
  };

  return (
    <section>
      <div className="section-head">
        <h2>My Files</h2>
        <button className="btn btn-secondary btn-sm" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}
      {loading && <p className="muted">Loading your files…</p>}

      {!loading && files.length === 0 && !error && (
        <p className="muted">You have no uploaded files yet. Use the form above to upload one.</p>
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
              <li><span>Uploaded</span> {formatDate(f.uploadedAt)}</li>
              <li><span>Owner</span> {shortAddress(f.owner)}</li>
              <li>
                <span>CID</span>
                <span className="mono cid-cell">
                  {shortAddress(f.cid, 10)}
                  <button className="link-btn" onClick={(e) => copyCid(e, f.cid)}>
                    {copiedCid === f.cid ? "copied ✓" : "copy"}
                  </button>
                  <a href={cidUrl(f.cid)} target="_blank" rel="noreferrer">open</a>
                </span>
              </li>
            </ul>
            <div className="file-actions">
              <DownloadButton file={f} account={account} />
              <button className="btn btn-secondary btn-sm" onClick={() => setShareFile(f)}>
                Share
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setManageFile(f)}>
                Manage access
              </button>
            </div>
          </div>
        ))}
      </div>

      {shareFile && (
        <ShareModal
          file={shareFile}
          account={account}
          onClose={() => setShareFile(null)}
          onShared={load}
        />
      )}
      {manageFile && (
        <ManageAccess
          file={manageFile}
          account={account}
          onClose={() => setManageFile(null)}
          onChanged={load}
        />
      )}
    </section>
  );
}
