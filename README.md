# Decentralized File Sharing System using Web3 Technologies

A decentralized file-sharing DApp that stores encrypted files on **IPFS** and manages
file ownership/access permissions via an **Ethereum smart contract** (`FileRegistry`),
so no single central server controls storage or access decisions.

- Files are encrypted **client-side** (AES-256-GCM) before leaving the browser.
- Only the encrypted blob is pinned to IPFS; the AES key is shared with grantees via
  **MetaMask-native encryption** (`eth_getEncryptionPublicKey` / `eth_decrypt`,
  x25519-xsalsa20-poly1305 ECIES).
- Ownership and access grants live on-chain; unauthorized wallets cannot decrypt content.

## Architecture

```
Browser (React DApp, frontend/)
  ├─ WalletConnect  ── MetaMask (identity + encryption keys)
  ├─ encryptionService.js  AES-256-GCM + ECIES key exchange
  ├─ ipfsService.js       Pinata pinning API (+ local dev server fallback)
  └─ contractService.js   FileRegistry calls + on-chain activity feed
        │
        ▼
FileRegistry.sol  (Ethereum, Solidity 0.8.24, ReentrancyGuard)
        │                stores: File{owner, cid, fileName, fileType, size, ...}
        │                        AccessGrant{grantee, encryptedKeyBlob, expiresAt, revoked}
        ▼
IPFS  ── encrypted blobs addressed by CID
```

## Repository structure

```
contracts/FileRegistry.sol     smart contract
test/FileRegistry.test.js      Hardhat test suite (28 tests)
scripts/deploy.js              deployment script
hardhat.config.js              Hardhat config (Sepolia + localhost)
frontend/                      Vite + React DApp
  src/components/              WalletConnect, FileUpload, MyFiles, ShareModal,
                               ManageAccess, DownloadButton, SharedWithMe,
                               ActivityLog, TransactionStatusToast
  src/hooks/useWallet.jsx      shared wallet context (account / signer / network)
  src/services/                encryption, ipfs, contract, access services
testing/                       local dev IPFS server + Playwright UI verification
RPC_ENDPOINT_SETUP_GUIDE.txt   step-by-step guide to obtain RPC/faucet/Etherscan keys
```

## Prerequisites

- Node.js 18+
- MetaMask browser extension
- For Sepolia: test ETH from a faucet, an RPC endpoint, and an Etherscan API key
  (see `RPC_ENDPOINT_SETUP_GUIDE.txt`)
- Optional for real IPFS uploads: a Pinata API key (free tier is enough)

## Setup

### 1. Backend (Hardhat)

```bash
npm install
npx hardhat compile
npx hardhat test            # 28 tests
```

Create a root `.env` (copy `.env.example`):

```
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID
SEPOLIA_PRIVATE_KEY=0xYOUR_DEPLOYER_WALLET_PRIVATE_KEY
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env
```

Edit `frontend/.env`:

```
VITE_PINATA_JWT=your_pinata_jwt            # real IPFS uploads
VITE_SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_PROJECT_ID
VITE_CHAIN_ID=11155111                     # 1337 for local Hardhat
VITE_CONTRACT_ADDRESS=0x...                # filled by the deploy script
```

### 3. Deploy the contract

```bash
# Local node (chain id 1337)
npx hardhat node
npm run deploy:local                       # writes frontend/.env.deployed

# Sepolia testnet
npm run deploy:sepolia                     # requires root .env values
npx hardhat verify --network sepolia <CONTRACT_ADDRESS>
```

> Note: on networks where Node's TLS to `api.etherscan.io` is blocked (but curl works),
> `hardhat verify` may fail with `A network request failed`. Verify via the Etherscan V2
> API with curl instead:
>
> ```bash
> KEY=$(node -e "console.log(require('dotenv').config().parsed.ETHERSCAN_API_KEY)")
> node -e "console.log(JSON.stringify(require('./artifacts/build-info/'+require('fs').readdirSync('artifacts/build-info')[0]).input))" > /tmp/input.json
> curl -X POST "https://api.etherscan.io/v2/api?chainid=11155111&module=contract&action=verifysourcecode" \
>   -H "Content-Type: application/x-www-form-urlencoded" \
>   --data-urlencode "apikey=$KEY" \
>   --data-urlencode "contractaddress=<CONTRACT_ADDRESS>" \
>   --data-urlencode "sourceCode@/tmp/input.json" \
>   --data-urlencode "codeformat=solidity-standard-json-input" \
>   --data-urlencode "contractname=contracts/FileRegistry.sol:FileRegistry" \
>   --data-urlencode "compilerversion=v0.8.24+commit.e11b9ed9" \
>   --data-urlencode "constructorArguements="
> ```
> then poll `...&module=contract&action=checkverifystatus&guid=<GUID>&apikey=$KEY`
> until it returns `Pass - Verified`.

Copy the deployed address from `frontend/.env.deployed` into `frontend/.env`
(`VITE_CONTRACT_ADDRESS`), then:

```bash
cd frontend && npm run dev
```

Open the DApp, connect MetaMask, and ensure you are on Sepolia (or localhost).

## Live deployment (Sepolia)

| Item | Value |
|---|---|
| Contract | `FileRegistry` |
| Address | [`0x004669b171665e0a07C8fFf12B3b4411991Dfb79`](https://sepolia.etherscan.io/address/0x004669b171665e0a07C8fFf12B3b4411991Dfb79) |
| Block | `0xae538d` |
| Deploy tx | `0x7c0083da0873374c9ae9e42e8c8b074fbb402ef3fd0290464999740d9e7dcfc9` |
| Gas used | 1,627,203 |
| Effective gas price | 1.29 gwei |
| Deployment fee | ≈ 0.0021 SepoliaETH |
| Etherscan | Source verified (Solidity `v0.8.24+commit.e11b9ed9`, optimizer 200 runs) |

`frontend/.env` points at this address, `VITE_CHAIN_ID=11155111`, with Pinata JWT set
for real IPFS uploads. Deployment verification was submitted against the Etherscan V2
API (`https://api.etherscan.io/v2/api`).

## UI verification

All contract endpoints are exercised through the real frontend with a scripted mock
MetaMask wallet (headless Chromium + local Hardhat node + local IPFS dev server):

```bash
cd testing
npm install
node run-ui-tests.mjs
```

Verified flows: connect wallet → upload (encrypt → IPFS → on-chain → owner self-grant)
→ My Files → stranger's "Shared With Me" is empty → grant access to Account B →
B downloads and decrypts byte-exact → revoke → B loses access → expiring access →
on-chain Activity Log with Etherscan links.

## Key design decision: key management

The AES file key is encrypted to the *grantee's* MetaMask encryption public key
(`x25519-xsalsa20-poly1305`, the same scheme MetaMask's `eth_decrypt` expects) and
stored on-chain in the `AccessGrant`. The owner also self-grants at upload time so
`getEncryptedKeyFor` works uniformly. Raw keys never appear on-chain.

## Security notes

- `frontend/.env`, root `.env`, `artifacts/`, `cache/`, `node_modules/` are git-ignored.
- Never commit JWTs, RPC keys, or private keys.
- Sepolia testnet only — no mainnet deployment is configured.
