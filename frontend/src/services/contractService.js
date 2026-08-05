import { ethers } from "ethers";
import { config } from "../config";
import FileRegistryAbi from "../abis/FileRegistry.json";

/**
 * Contract interaction service (Module 7).
 * Wraps all FileRegistry contract calls with ethers v6 and provides helpers
 * to query the on-chain activity events (FileUploaded / AccessGranted /
 * AccessRevoked) that power the Activity Log (Module 10).
 */

let cachedContract = null;
let cachedSigner = null;

/**
 * Get a read-only provider connected to the configured RPC.
 * Works without a wallet (used for event queries).
 */
export function getProvider() {
  return new ethers.JsonRpcProvider(config.rpcUrl);
}

/**
 * Get a contract instance connected to a signer (for transactions).
 * @param {ethers.JsonRpcSigner|null} signer optional connected wallet signer
 */
export function getContract(signer = null) {
  const address = config.contractAddress;
  const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
  if (!address || address === ZERO_ADDR) {
    throw new Error(
      "Smart contract is not deployed / configured. Run the deploy script and set VITE_CONTRACT_ADDRESS."
    );
  }
  if (signer) {
    return new ethers.Contract(address, FileRegistryAbi, signer);
  }
  if (cachedContract) return cachedContract;
  cachedContract = new ethers.Contract(address, FileRegistryAbi, getProvider());
  return cachedContract;
}

export function connectContract(signer) {
  const contract = getContract(signer);
  cachedSigner = signer;
  return contract;
}

/** Upload a file registration to the contract. */
export async function uploadFile(cid, fileName, fileType, fileSize) {
  const contract = getContract(cachedSigner);
  return contract.uploadFile(cid, fileName, fileType, fileSize);
}

/** Grant access to a wallet. */
export async function grantAccess(fileId, granteeAddress, encryptedKeyBlob, expiresAt) {
  const contract = getContract(cachedSigner);
  return contract.grantAccess(fileId, granteeAddress, encryptedKeyBlob, expiresAt || 0);
}

/** Revoke access from a wallet. */
export async function revokeAccess(fileId, granteeAddress) {
  const contract = getContract(cachedSigner);
  return contract.revokeAccess(fileId, granteeAddress);
}

/** Check whether a user can access a file. */
export async function hasAccess(fileId, address) {
  const contract = getContract();
  return contract.hasAccess(fileId, address);
}

/** List file ids owned by the connected wallet. */
export async function getMyFiles() {
  const contract = getContract(cachedSigner);
  const ids = await contract.getMyFiles();
  return ids.map((id) => Number(id));
}

/** List file ids shared with the connected wallet. */
export async function getFilesSharedWithMe() {
  const contract = getContract(cachedSigner);
  const ids = await contract.getFilesSharedWithMe();
  return ids.map((id) => Number(id));
}

/** Get the encrypted key blob for a user with access. */
export async function getEncryptedKeyFor(fileId, address) {
  const contract = getContract();
  return contract.getEncryptedKeyFor(fileId, address);
}

/** Read a single file record. */
export async function getFile(fileId) {
  const contract = getContract();
  const f = await contract.files(fileId);
  return {
    id: Number(f.id),
    owner: f.owner,
    cid: f.cid,
    fileName: f.fileName,
    fileType: f.fileType,
    fileSize: Number(f.fileSize),
    uploadedAt: Number(f.uploadedAt),
    isActive: f.isActive,
  };
}

/** Number of access grants for a file. */
export async function getGrantCount(fileId) {
  const contract = getContract();
  return Number(await contract.getGrantCount(fileId));
}

/** Read a single access grant. */
export async function getGrant(fileId, index) {
  const contract = getContract();
  const g = await contract.getGrant(fileId, index);
  return {
    grantee: g.grantee,
    encryptedKeyBlob: g.encryptedKeyBlob,
    grantedAt: Number(g.grantedAt),
    expiresAt: Number(g.expiresAt),
    revoked: g.revoked,
  };
}

/* ------------------------------------------------------------------ */
/* Event queries for the Activity Log                                 */
/* ------------------------------------------------------------------ */

/** Query FileUploaded events (optionally filtered by owner). */
export async function getFileUploadedEvents(fromBlock = 0, ownerAddress = null) {
  const contract = getContract();
  const events = await contract.queryFilter("FileUploaded", fromBlock, "latest");
  if (!ownerAddress) return events;
  const target = ownerAddress.toLowerCase();
  return events.filter((e) => e.args.owner.toLowerCase() === target);
}

/** Query AccessGranted events (optionally filtered by grantee). */
export async function getAccessGrantedEvents(fromBlock = 0, granteeAddress = null) {
  const contract = getContract();
  const events = await contract.queryFilter("AccessGranted", fromBlock, "latest");
  if (!granteeAddress) return events;
  const target = granteeAddress.toLowerCase();
  return events.filter((e) => e.args.grantee.toLowerCase() === target);
}

/** Query AccessRevoked events (optionally filtered by grantee). */
export async function getAccessRevokedEvents(fromBlock = 0, granteeAddress = null) {
  const contract = getContract();
  const events = await contract.queryFilter("AccessRevoked", fromBlock, "latest");
  if (!granteeAddress) return events;
  const target = granteeAddress.toLowerCase();
  return events.filter((e) => e.args.grantee.toLowerCase() === target);
}

// RPC providers (Infura, etc.) cap eth_getLogs to a fixed block range
// (Sepolia: 10,000 blocks). Querying from block 0 therefore fails. When no
// explicit fromBlock is given we bound the search to the most recent range.
const MAX_LOGS_RANGE = 9000;

/** Resolve an explicit fromBlock, else the newest <MAX_LOGS_RANGE> blocks. */
export async function resolveFromBlock(fromBlock) {
  if (fromBlock > 0) return fromBlock;
  const latest = await getProvider().getBlockNumber();
  return Math.max(0, latest - MAX_LOGS_RANGE);
}

/**
 * Fetch all activity events merged into a single chronological list.
 * When `address` is provided, only events where that address is the owner or
 * the grantee are returned.
 * @returns {Promise<Array<{type, fileId, owner, other, cid, txHash, timestamp, blockNumber}>>}
 */
export async function getActivityFeed(fromBlock = 0, address = null) {
  const resolvedFrom = await resolveFromBlock(fromBlock);
  const [uploads, grants, revokes] = await Promise.all([
    getFileUploadedEvents(resolvedFrom),
    getAccessGrantedEvents(resolvedFrom),
    getAccessRevokedEvents(resolvedFrom),
  ]);

  const items = [];

  for (const e of uploads) {
    const block = await e.getBlock();
    const owner = e.args[1];
    if (address && owner.toLowerCase() !== address.toLowerCase()) continue;
    items.push({
      type: "uploaded",
      fileId: Number(e.args[0]),
      owner,
      cid: e.args[2],
      txHash: e.transactionHash,
      timestamp: block.timestamp,
      blockNumber: e.blockNumber,
    });
  }
  for (const e of grants) {
    const block = await e.getBlock();
    const owner = e.args[1];
    const grantee = e.args[2];
    if (address) {
      const a = address.toLowerCase();
      if (owner.toLowerCase() !== a && grantee.toLowerCase() !== a) continue;
    }
    items.push({
      type: "granted",
      fileId: Number(e.args[0]),
      owner,
      other: grantee,
      txHash: e.transactionHash,
      timestamp: block.timestamp,
      blockNumber: e.blockNumber,
    });
  }
  for (const e of revokes) {
    const block = await e.getBlock();
    const owner = e.args[1];
    const grantee = e.args[2];
    if (address) {
      const a = address.toLowerCase();
      if (owner.toLowerCase() !== a && grantee.toLowerCase() !== a) continue;
    }
    items.push({
      type: "revoked",
      fileId: Number(e.args[0]),
      owner,
      other: grantee,
      txHash: e.transactionHash,
      timestamp: block.timestamp,
      blockNumber: e.blockNumber,
    });
  }

  items.sort((a, b) => b.blockNumber - a.blockNumber || b.timestamp - a.timestamp);
  return items;
}
