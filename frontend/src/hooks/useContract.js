import { useCallback, useMemo } from "react";
import { connectContract } from "../services/contractService";
import * as contractApi from "../services/contractService";

/**
 * Hook that exposes the contract service functions bound to the connected
 * wallet signer. Import `contractApi` in components for the plain functions.
 */
export function useContract(signer, account) {
  useMemo(() => {
    if (signer) {
      connectContract(signer);
    }
  }, [signer]);

  const bound = useMemo(() => {
    if (!signer) return null;
    return {
      uploadFile: (cid, fileName, fileType, fileSize) =>
        contractApi.uploadFile(cid, fileName, fileType, fileSize),
      grantAccess: (fileId, granteeAddress, encryptedKeyBlob, expiresAt) =>
        contractApi.grantAccess(fileId, granteeAddress, encryptedKeyBlob, expiresAt),
      revokeAccess: (fileId, granteeAddress) =>
        contractApi.revokeAccess(fileId, granteeAddress),
      getMyFiles: () => contractApi.getMyFiles(),
      getFilesSharedWithMe: () => contractApi.getFilesSharedWithMe(),
      hasAccess: (fileId, address) => contractApi.hasAccess(fileId, address || account),
    };
  }, [signer, account]);

  const listFiles = useCallback(
    async (ids) => {
      const out = [];
      for (const id of ids) {
        try {
          out.push(await contractApi.getFile(id));
        } catch (err) {
          console.error(`Failed to read file ${id}:`, err);
        }
      }
      return out;
    },
    []
  );

  return { contractApi, bound, listFiles };
}
