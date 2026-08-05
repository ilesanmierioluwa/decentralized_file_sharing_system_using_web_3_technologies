/**
 * Frontend configuration.
 * Values come from Vite environment variables (import.meta.env).
 * Copy frontend/.env.example to frontend/.env and fill in real values.
 */
const env = import.meta.env;

export const config = {
  /** Pinata JWT used to pin files to IPFS. Leave empty to use the local
   *  dev IPFS mode (VITE_LOCAL_IPFS_URL). */
  pinataJwt: env.VITE_PINATA_JWT || "",

  /** Public IPFS gateway(s) used to fetch files. Tried in order. */
  gateways: [
    env.VITE_GATEWAY || "",
    "https://gateway.pinata.cloud/ipfs/",
    "https://ipfs.io/ipfs/",
  ].filter(Boolean),

  /** Optional local IPFS-compatible dev server (upload endpoint). */
  localIpfsUrl: env.VITE_LOCAL_IPFS_URL || "",

  /** Contract address of the deployed FileRegistry. */
  contractAddress: env.VITE_CONTRACT_ADDRESS || "",

  /** RPC URL used by the frontend provider. Defaults to a public Sepolia
   *  endpoint so the app works out of the box on the demo network. */
  rpcUrl:
    env.VITE_SEPOLIA_RPC_URL ||
    "https://rpc.sepolia.org",

  /** Expected network chain id. 11155111 = Sepolia, 1337 = local Hardhat. */
  chainId: Number(env.VITE_CHAIN_ID || 11155111),

  /** Addresses / metadata of the supported networks for the "switch network"
   *  prompt in WalletConnect. */
  supportedNetworks: [
    {
      chainId: 11155111,
      chainName: "Sepolia",
      currencyName: "SepoliaETH",
      currencySymbol: "ETH",
      rpcUrl: env.VITE_SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      blockExplorer: "https://sepolia.etherscan.io",
    },
    {
      chainId: 1337,
      chainName: "Localhost (Hardhat)",
      currencyName: "Ether",
      currencySymbol: "ETH",
      rpcUrl: "http://127.0.0.1:8545",
      blockExplorer: "",
    },
  ],

  /** Fixed message used only for informative purposes; encryption uses the
   *  wallet's native eth_getEncryptionPublicKey / eth_decrypt methods. */
  keyDerivationMessage:
    "Decentralized File Sharing - please sign only to prove wallet ownership",
};

export const EXPLORER_URL = config.supportedNetworks.find(
  (n) => n.chainId === config.chainId
)?.blockExplorer || "https://sepolia.etherscan.io";

/** Returns a full Etherscan-style link for a transaction hash. */
export function txUrl(txHash) {
  return `${EXPLORER_URL}/tx/${txHash}`;
}

/** Returns a gateway URL for an IPFS cid. */
export function cidUrl(cid) {
  const first = config.gateways[0] || "https://ipfs.io/ipfs/";
  return `${first}${cid}`;
}
