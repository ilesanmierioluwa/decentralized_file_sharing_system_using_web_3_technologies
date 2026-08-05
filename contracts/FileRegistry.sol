// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FileRegistry
 * @notice Decentralized file sharing registry built on IPFS + Ethereum.
 *         IPFS stores the (encrypted) file bytes; this contract stores the
 *         content identifier (CID), file metadata, ownership and access
 *         permissions. Files are encrypted client-side before they ever reach
 *         IPFS, so the public network never sees plaintext content. Access is
 *         managed per-wallet-address through AccessGrant records, each carrying
 *         an encrypted key blob that only the grantee's wallet can decrypt.
 */
contract FileRegistry is ReentrancyGuard {
    /// @notice A file registered on-chain. The actual bytes live on IPFS.
    struct File {
        uint256 id;          // unique file id (starts at 1)
        address owner;       // wallet address that uploaded the file
        string cid;          // IPFS content identifier of the encrypted blob
        string fileName;     // original file name
        string fileType;     // MIME type
        uint256 fileSize;    // size in bytes (of the encrypted blob)
        uint256 uploadedAt;  // block timestamp of upload
        bool isActive;       // false = soft-deleted (hidden by the UI)
    }

    /// @notice A permission entry granting a wallet access to one file.
    struct AccessGrant {
        address grantee;            // wallet granted access
        string encryptedKeyBlob;    // AES key encrypted to the grantee's pubkey
        uint256 grantedAt;          // timestamp when access was granted
        uint256 expiresAt;          // 0 = never expires
        bool revoked;               // true = access has been revoked
    }

    /// @notice All registered files, indexed by file id.
    mapping(uint256 => File) public files;

    /// @notice All access grants for a given file id.
    mapping(uint256 => AccessGrant[]) public fileAccessGrants;

    /// @notice File ids owned by each wallet address.
    mapping(address => uint256[]) public ownerFiles;

    /// @notice File ids shared with each wallet address.
    mapping(address => uint256[]) public sharedWithMe;

    /// @notice Total number of files ever registered.
    uint256 public fileCount;

    /// @dev Emitted when a file is uploaded.
    event FileUploaded(
        uint256 indexed fileId,
        address indexed owner,
        string cid,
        uint256 timestamp
    );

    /// @dev Emitted when access to a file is granted to a wallet.
    event AccessGranted(
        uint256 indexed fileId,
        address indexed owner,
        address indexed grantee,
        uint256 timestamp
    );

    /// @dev Emitted when access to a file is revoked from a wallet.
    event AccessRevoked(
        uint256 indexed fileId,
        address indexed owner,
        address indexed grantee,
        uint256 timestamp
    );

    /**
     * @notice Registers a new file owned by the caller.
     * @param cid The IPFS content identifier of the encrypted file blob.
     * @param fileName The original file name.
     * @param fileType The MIME type of the file.
     * @param fileSize The size of the encrypted blob in bytes.
     * @return fileId The id assigned to the new file.
     */
    function uploadFile(
        string calldata cid,
        string calldata fileName,
        string calldata fileType,
        uint256 fileSize
    ) external nonReentrant returns (uint256 fileId) {
        require(bytes(cid).length > 0, "FileRegistry: cid is required");
        require(bytes(fileName).length > 0, "FileRegistry: file name is required");
        require(fileSize > 0, "FileRegistry: file size must be greater than zero");

        fileCount += 1;
        files[fileCount] = File({
            id: fileCount,
            owner: msg.sender,
            cid: cid,
            fileName: fileName,
            fileType: fileType,
            fileSize: fileSize,
            uploadedAt: block.timestamp,
            isActive: true
        });
        ownerFiles[msg.sender].push(fileCount);

        emit FileUploaded(fileCount, msg.sender, cid, block.timestamp);
        return fileCount;
    }

    /**
     * @notice Grants a wallet address access to a file owned by the caller.
     * @param fileId The id of the file to share.
     * @param grantee The wallet address receiving access.
     * @param encryptedKeyBlob The AES file key, encrypted to the grantee's
     *        public key (never store a raw key on-chain).
     * @param expiresAt UNIX timestamp when access expires, or 0 for no expiry.
     */
    function grantAccess(
        uint256 fileId,
        address grantee,
        string calldata encryptedKeyBlob,
        uint256 expiresAt
    ) external nonReentrant {
        require(files[fileId].id != 0, "FileRegistry: file does not exist");
        require(files[fileId].owner == msg.sender, "FileRegistry: not the file owner");
        require(grantee != address(0), "FileRegistry: cannot grant to zero address");
        require(bytes(encryptedKeyBlob).length > 0, "FileRegistry: encrypted key blob is required");
        if (expiresAt != 0) {
            require(expiresAt > block.timestamp, "FileRegistry: expiry must be in the future");
        }

        AccessGrant[] storage grants = fileAccessGrants[fileId];
        bool alreadyGranted = false;
        for (uint256 i = 0; i < grants.length; i++) {
            if (grants[i].grantee == grantee) {
                grants[i].encryptedKeyBlob = encryptedKeyBlob;
                grants[i].grantedAt = block.timestamp;
                grants[i].expiresAt = expiresAt;
                grants[i].revoked = false;
                alreadyGranted = true;
                break;
            }
        }

        if (!alreadyGranted) {
            grants.push(AccessGrant({
                grantee: grantee,
                encryptedKeyBlob: encryptedKeyBlob,
                grantedAt: block.timestamp,
                expiresAt: expiresAt,
                revoked: false
            }));
            sharedWithMe[grantee].push(fileId);
        }

        emit AccessGranted(fileId, msg.sender, grantee, block.timestamp);
    }

    /**
     * @notice Revokes a wallet's access to a file owned by the caller.
     * @param fileId The id of the file.
     * @param grantee The wallet address whose access is being revoked.
     */
    function revokeAccess(uint256 fileId, address grantee) external nonReentrant {
        require(files[fileId].id != 0, "FileRegistry: file does not exist");
        require(files[fileId].owner == msg.sender, "FileRegistry: not the file owner");
        require(grantee != files[fileId].owner, "FileRegistry: owner always has access");

        AccessGrant[] storage grants = fileAccessGrants[fileId];
        bool found = false;
        for (uint256 i = 0; i < grants.length; i++) {
            if (grants[i].grantee == grantee) {
                require(!grants[i].revoked, "FileRegistry: access already revoked");
                grants[i].revoked = true;
                found = true;
                break;
            }
        }
        require(found, "FileRegistry: no access grant found for grantee");

        emit AccessRevoked(fileId, msg.sender, grantee, block.timestamp);
    }

    /**
     * @notice Returns whether a user may access a file.
     * @dev The owner always has access. Grantees have access unless their
     *      grant is revoked or expired.
     * @param fileId The id of the file.
     * @param user The wallet address to check.
     * @return True if the user can access the file.
     */
    function hasAccess(uint256 fileId, address user) public view returns (bool) {
        if (files[fileId].id == 0) return false;
        if (files[fileId].owner == user) return true;

        AccessGrant[] storage grants = fileAccessGrants[fileId];
        for (uint256 i = 0; i < grants.length; i++) {
            AccessGrant storage g = grants[i];
            if (g.grantee == user && !g.revoked) {
                if (g.expiresAt == 0 || g.expiresAt > block.timestamp) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * @notice Returns the ids of all files owned by the caller.
     * @return An array of file ids owned by msg.sender.
     */
    function getMyFiles() external view returns (uint256[] memory) {
        return ownerFiles[msg.sender];
    }

    /**
     * @notice Returns the ids of all files shared with the caller.
     * @return An array of file ids shared with msg.sender.
     */
    function getFilesSharedWithMe() external view returns (uint256[] memory) {
        return sharedWithMe[msg.sender];
    }

    /**
     * @notice Returns the encrypted key blob for a user who has access.
     * @param fileId The id of the file.
     * @param user The wallet address requesting their encrypted key.
     * @return The encrypted AES key blob for that user (empty if none).
     */
    function getEncryptedKeyFor(uint256 fileId, address user) external view returns (string memory) {
        require(hasAccess(fileId, user), "FileRegistry: no access");
        AccessGrant[] storage grants = fileAccessGrants[fileId];
        for (uint256 i = 0; i < grants.length; i++) {
            if (grants[i].grantee == user && !grants[i].revoked) {
                return grants[i].encryptedKeyBlob;
            }
        }
        return "";
    }

    /**
     * @notice Returns the number of access grants recorded for a file.
     * @param fileId The id of the file.
     * @return The number of grants (including revoked ones).
     */
    function getGrantCount(uint256 fileId) external view returns (uint256) {
        return fileAccessGrants[fileId].length;
    }

    /**
     * @notice Returns a single access grant for a file.
     * @param fileId The id of the file.
     * @param index The index into the file's grant list.
     * @return grantee The granted wallet address.
     * @return encryptedKeyBlob The encrypted AES key blob.
     * @return grantedAt Timestamp when access was granted.
     * @return expiresAt Timestamp when access expires (0 = never).
     * @return revoked Whether access has been revoked.
     */
    function getGrant(uint256 fileId, uint256 index)
        external
        view
        returns (
            address grantee,
            string memory encryptedKeyBlob,
            uint256 grantedAt,
            uint256 expiresAt,
            bool revoked
        )
    {
        AccessGrant storage g = fileAccessGrants[fileId][index];
        return (g.grantee, g.encryptedKeyBlob, g.grantedAt, g.expiresAt, g.revoked);
    }

    /**
     * @notice Marks a file as inactive (soft-delete). The on-chain record is
     *         kept immutable; the UI simply stops showing inactive files.
     * @param fileId The id of the file to hide.
     */
    function deactivateFile(uint256 fileId) external nonReentrant {
        require(files[fileId].id != 0, "FileRegistry: file does not exist");
        require(files[fileId].owner == msg.sender, "FileRegistry: not the file owner");
        files[fileId].isActive = false;
    }
}
