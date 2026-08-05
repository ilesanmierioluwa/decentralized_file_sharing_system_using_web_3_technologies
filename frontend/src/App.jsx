import { useMemo, useState } from "react";
import { ToastProvider } from "./context/ToastContext";
import { WalletProvider, useWallet } from "./hooks/useWallet.jsx";
import { connectContract } from "./services/contractService";
import WalletConnect from "./components/WalletConnect";
import FileUpload from "./components/FileUpload";
import MyFiles from "./components/MyFiles";
import SharedWithMe from "./components/SharedWithMe";
import ActivityLog from "./components/ActivityLog";
import TransactionStatusToast from "./components/TransactionStatusToast";
import { config } from "./config";

const TABS = [
  { id: "mine", label: "My Files" },
  { id: "shared", label: "Shared With Me" },
  { id: "activity", label: "Activity Log" },
];

function AppInner() {
  const wallet = useWallet();
  const { account, signer, signerAccount, isCorrectNetwork } = wallet;
  const [tab, setTab] = useState("mine");
  const [uploadVersion, setUploadVersion] = useState(0);

  // Bind the connected signer to the contract service synchronously during
  // render so child component effects can already use the wallet's signer.
  useMemo(() => {
    if (signer) {
      try {
        connectContract(signer);
      } catch (err) {
        console.error(err);
      }
    }
  }, [signer]);

  // Only mount account-scoped views once the signer has caught up with the
  // active account (avoids reading contract state through a stale signer
  // right after an accountsChanged switch).
  const ready =
    account && isCorrectNetwork && signerAccount === account.toLowerCase();

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-logo">◈</span>
          <div>
            <h1>Decentralized File Share</h1>
            <span className="muted small">IPFS + Ethereum · client-side encrypted · no central server</span>
          </div>
        </div>
        <WalletConnect />
      </header>

      {!account && (
        <main className="main">
          <div className="card center-card">
            <h2>Connect your wallet to get started</h2>
            <p className="muted">
              Your wallet is your identity — no username or password. This DApp stores
              encrypted files on IPFS and manages ownership and access permissions on the
              Ethereum Sepolia testnet.
            </p>
          </div>
        </main>
      )}

      {account && !isCorrectNetwork && (
        <main className="main">
          <div className="card center-card warn-card">
            <h2>Wrong network</h2>
            <p className="muted">
              This DApp needs you to be on the{" "}
              {config.supportedNetworks.find((n) => n.chainId === config.chainId)?.chainName ||
                `chain ${config.chainId}`}{" "}
              network. Use the button above to switch.
            </p>
          </div>
        </main>
      )}

      {ready && (
        <main className="main">
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`tab ${tab === t.id ? "active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {tab === "mine" && (
            <>
              <FileUpload account={account} onUploaded={() => setUploadVersion((v) => v + 1)} />
              <MyFiles account={account} reloadToken={uploadVersion} />
            </>
          )}
          {tab === "shared" && <SharedWithMe account={account} />}
          {tab === "activity" && <ActivityLog account={account} />}
        </main>
      )}

      <footer className="footer">
        <span className="muted small">
          Stored on IPFS · permissions enforced by the FileRegistry smart contract · keys never leave your wallet
        </span>
      </footer>

      <TransactionStatusToast />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <WalletProvider>
        <AppInner />
      </WalletProvider>
    </ToastProvider>
  );
}
