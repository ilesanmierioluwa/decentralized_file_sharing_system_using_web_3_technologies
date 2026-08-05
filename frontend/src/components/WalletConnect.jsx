import { useWallet } from "../hooks/useWallet.jsx";
import { config } from "../config";

/**
 * Wallet connection bar (Module 1). Shows connect button, the connected
 * address, and a prominent prompt to switch network when the wallet is on the
 * wrong chain.
 */
export default function WalletConnect() {
  const {
    account,
    chainId,
    signer,
    connecting,
    error,
    isCorrectNetwork,
    connect,
    switchNetwork,
    disconnect,
  } = useWallet();

  if (error) {
    return (
      <div className="wallet-bar error">
        <span className="dot dot-red" />
        <span className="wallet-error">{error}</span>
        <button className="btn btn-secondary" onClick={connect}>
          Try again
        </button>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="wallet-bar">
        <span className="dot dot-gray" />
        <span className="muted">Not connected</span>
        <button className="btn btn-primary" onClick={connect} disabled={connecting}>
          {connecting ? "Connecting..." : "Connect Wallet"}
        </button>
      </div>
    );
  }

  if (!isCorrectNetwork) {
    return (
      <div className="wallet-bar warn">
        <span className="dot dot-orange" />
        <span>
          Connected: <strong>{short(account)}</strong> on wrong network
          (chain {chainId}). Expected {config.chainId}.
        </span>
        <button className="btn btn-warn" onClick={switchNetwork}>
          Switch to {config.supportedNetworks.find((n) => n.chainId === config.chainId)?.chainName}
        </button>
        <button className="btn btn-ghost" onClick={disconnect}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="wallet-bar">
      <span className="dot dot-green" />
      <span>
        Connected: <strong>{short(account)}</strong> on{" "}
        {config.supportedNetworks.find((n) => n.chainId === config.chainId)?.chainName || chainId}
      </span>
      {signer && <span className="badge">wallet ready</span>}
      <button className="btn btn-ghost" onClick={disconnect}>
        Disconnect
      </button>
    </div>
  );
}

function short(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
