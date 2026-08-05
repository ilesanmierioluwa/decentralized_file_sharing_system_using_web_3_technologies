/**
 * ManageAccess (Module 8): lists the current grantees of a file and lets the
 * owner revoke access per grantee.
 */
import { useCallback, useEffect, useState } from "react";
import { useToasts } from "../context/ToastContext";
import { getGrantCount, getGrant, revokeAccess } from "../services/contractService";
import { shortAddress, formatDate } from "../utils/fileUtils";

export default function ManageAccess({ file, account, onClose, onChanged }) {
  const { show, watchTransaction } = useToasts();
  const [grants, setGrants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState(null);

  const loadGrants = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const count = await getGrantCount(file.id);
      const list = [];
      for (let i = 0; i < count; i++) {
        list.push(await getGrant(file.id, i));
      }
      setGrants(list);
    } catch (err) {
      setError(err?.message || "Failed to load access grants.");
    } finally {
      setLoading(false);
    }
  }, [file.id]);

  useEffect(() => {
    loadGrants();
  }, [loadGrants]);

  const handleRevoke = async (grantee) => {
    setRevoking(grantee);
    try {
      await watchTransaction(
        revokeAccess(file.id, grantee),
        { title: "Access revocation", successTitle: "Access revoked" }
      );
      show({
        type: "success",
        title: "Access revoked",
        message: `${shortAddress(grantee)} can no longer access "${file.fileName}".`,
        autoDismiss: 6000,
      });
      onChanged?.();
      await loadGrants();
    } catch (err) {
      show({
        type: "error",
        title: "Revoke failed",
        message: err?.reason || err?.message || "An unexpected error occurred.",
        autoDismiss: 9000,
      });
    } finally {
      setRevoking(null);
    }
  };

  const active = grants.filter((g) => !g.revoked && (g.expiresAt === 0 || g.expiresAt > Math.floor(Date.now() / 1000)));
  const inactive = grants.filter((g) => !active.includes(g));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Access for "{file.fileName}"</h3>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>

        {error && <div className="form-error">{error}</div>}
        {loading && <p className="muted">Loading grantees…</p>}

        {!loading && active.length === 0 && (
          <p className="muted">No active grantees. Share this file to grant access.</p>
        )}

        {active.length > 0 && (
          <table className="grants-table">
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Granted</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {active.map((g) => (
                <tr key={g.grantee}>
                  <td className="mono">{shortAddress(g.grantee, 8)}</td>
                  <td>{formatDate(g.grantedAt)}</td>
                  <td>{g.expiresAt === 0 ? "Never" : formatDate(g.expiresAt)}</td>
                  <td>
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={revoking === g.grantee}
                      onClick={() => handleRevoke(g.grantee)}
                    >
                      {revoking === g.grantee ? "Revoking..." : "Revoke"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {inactive.length > 0 && (
          <>
            <h4 className="muted">Revoked / expired</h4>
            <ul className="inactive-list">
              {inactive.map((g) => (
                <li key={g.grantee} className="mono">
                  {shortAddress(g.grantee, 8)}
                  {g.revoked ? " (revoked)" : " (expired)"}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
