import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { BrowserProvider } from "ethers";
import { config } from "../config";

const WalletContext = createContext(null);

/**
 * Wallet connection hook (Module 1). Provided via WalletProvider so every
 * component shares the same connection state.
 */
export function WalletProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [signer, setSigner] = useState(null);
  const [signerAccount, setSignerAccount] = useState(null);

  const ethereum = typeof window !== "undefined" ? window.ethereum : null;

  const isCorrectNetwork = chainId === config.chainId;

  const refreshSigner = useCallback(async (acc) => {
    if (!acc || !window.ethereum) return null;
    const provider = new BrowserProvider(window.ethereum);
    const s = await provider.getSigner(acc);
    setSigner(s);
    setSignerAccount(acc.toLowerCase());
    return s;
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      if (!window.ethereum) {
        throw new Error(
          "No Web3 wallet detected. Install the MetaMask browser extension and refresh."
        );
      }
      if (!window.ethereum.isMetaMask) {
        throw new Error("Please use MetaMask (or another EIP-1193 wallet).");
      }

      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (!accounts || accounts.length === 0) {
        throw new Error("No account returned by the wallet.");
      }
      const acc = accounts[0];

      const chain = await window.ethereum.request({ method: "eth_chainId" });
      setChainId(Number(chain));
      setAccount(acc);
      await refreshSigner(acc);
    } catch (err) {
      if (err?.code === 4001) {
        setError("Connection rejected by the wallet.");
      } else {
        setError(err?.message || "Failed to connect wallet.");
      }
    } finally {
      setConnecting(false);
    }
  }, [refreshSigner]);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    const target = config.supportedNetworks.find((n) => n.chainId === config.chainId);
    if (!target) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + target.chainId.toString(16) }],
      });
    } catch (err) {
      if (err?.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x" + target.chainId.toString(16),
              chainName: target.chainName,
              nativeCurrency: {
                name: target.currencyName,
                symbol: target.currencySymbol,
                decimals: 18,
              },
              rpcUrls: [target.rpcUrl],
            },
          ],
        });
      } else {
        throw err;
      }
    }
    const chain = await window.ethereum.request({ method: "eth_chainId" });
    setChainId(Number(chain));
  }, []);

  const disconnect = useCallback(() => {
    setAccount(null);
    setSigner(null);
    setSignerAccount(null);
    setChainId(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!ethereum) return;
    const handleAccountsChanged = (accounts) => {
      if (!accounts || accounts.length === 0) {
        disconnect();
      } else {
        setAccount(accounts[0]);
        refreshSigner(accounts[0]);
      }
    };
    const handleChainChanged = (hexId) => {
      setChainId(Number(hexId));
    };
    ethereum.on("accountsChanged", handleAccountsChanged);
    ethereum.on("chainChanged", handleChainChanged);
    return () => {
      ethereum.removeListener("accountsChanged", handleAccountsChanged);
      ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, [ethereum, refreshSigner, disconnect]);

  // Re-create the signer whenever the wallet lands on the configured network.
  // The signer is initially created during connect() while the wallet may
  // still be on a different chain, which pins its ethers provider to that
  // chain and makes reads throw ethers' "network changed" NETWORK_ERROR after
  // the app switches networks. A fresh provider created on the correct chain
  // avoids that stale-network binding.
  useEffect(() => {
    if (account && chainId === config.chainId) {
      refreshSigner(account);
    }
  }, [account, chainId, refreshSigner]);

  // Auto-reconnect if the wallet is already unlocked with the expected chain.
  useEffect(() => {
    const tryAutoConnect = async () => {
      try {
        if (!window.ethereum) return;
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        if (accounts && accounts.length > 0) {
          const chain = await window.ethereum.request({ method: "eth_chainId" });
          setChainId(Number(chain));
          setAccount(accounts[0]);
          await refreshSigner(accounts[0]);
        }
      } catch {
        /* ignore */
      }
    };
    tryAutoConnect();
  }, [refreshSigner]);

  const value = {
    account,
    chainId,
    signer,
    signerAccount,
    connecting,
    error,
    isCorrectNetwork,
    connect,
    switchNetwork,
    disconnect,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
