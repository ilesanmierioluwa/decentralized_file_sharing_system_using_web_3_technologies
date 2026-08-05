const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FileRegistry", function () {
  let FileRegistry, fileRegistry;
  let owner, alice, bob, mallory;

  beforeEach(async function () {
    [owner, alice, bob, mallory] = await ethers.getSigners();
    FileRegistry = await ethers.getContractFactory("FileRegistry");
    fileRegistry = await FileRegistry.deploy();
    await fileRegistry.waitForDeployment();
  });

  describe("uploadFile", function () {
    it("creates a file owned by the caller and emits FileUploaded", async function () {
      const cid = "QmExampleCid1234567890";
      const tx = await fileRegistry.uploadFile(cid, "report.pdf", "application/pdf", 12345);
      const end = await ethers.provider.getBlock("latest");

      await expect(tx)
        .to.emit(fileRegistry, "FileUploaded")
        .withArgs(1, owner.address, cid, end.timestamp);

      const file = await fileRegistry.files(1);
      expect(file.id).to.equal(1);
      expect(file.owner).to.equal(owner.address);
      expect(file.cid).to.equal(cid);
      expect(file.fileName).to.equal("report.pdf");
      expect(file.fileType).to.equal("application/pdf");
      expect(file.fileSize).to.equal(12345);
      expect(file.isActive).to.equal(true);
      expect(await fileRegistry.fileCount()).to.equal(1);
    });

    it("increments file id and adds to ownerFiles for each upload", async function () {
      await fileRegistry.uploadFile("QmA", "a.txt", "text/plain", 10);
      await fileRegistry.uploadFile("QmB", "b.txt", "text/plain", 20);

      expect(await fileRegistry.fileCount()).to.equal(2);
      const mine = await fileRegistry.getMyFiles();
      expect(mine.length).to.equal(2);
      expect(mine[0]).to.equal(1);
      expect(mine[1]).to.equal(2);
    });

    it("reverts when cid is empty", async function () {
      await expect(
        fileRegistry.uploadFile("", "a.txt", "text/plain", 10)
      ).to.be.revertedWith("FileRegistry: cid is required");
    });

    it("reverts when file size is zero", async function () {
      await expect(
        fileRegistry.uploadFile("QmA", "a.txt", "text/plain", 0)
      ).to.be.revertedWith("FileRegistry: file size must be greater than zero");
    });
  });

  describe("grantAccess", function () {
    let fileId;

    beforeEach(async function () {
      const tx = await fileRegistry.uploadFile("QmCid", "doc.pdf", "application/pdf", 500);
      const receipt = await tx.wait();
      fileId = 1;
    });

    it("grants access and emits AccessGranted", async function () {
      await ethers.provider.send("evm_mine");
      const latest = await ethers.provider.getBlock("latest");
      await expect(
        fileRegistry.grantAccess(fileId, alice.address, "encryptedBlobAlice", 0)
      )
        .to.emit(fileRegistry, "AccessGranted")
        .withArgs(fileId, owner.address, alice.address, latest.timestamp + 1);

      expect(await fileRegistry.hasAccess(fileId, alice.address)).to.equal(true);
      const shared = await fileRegistry.connect(alice).getFilesSharedWithMe();
      expect(shared.length).to.equal(1);
      expect(shared[0]).to.equal(1);
    });

    it("reverts when called by a non-owner", async function () {
      await expect(
        fileRegistry.connect(alice).grantAccess(fileId, bob.address, "blob", 0)
      ).to.be.revertedWith("FileRegistry: not the file owner");
    });

    it("reverts when granting to the zero address", async function () {
      await expect(
        fileRegistry.grantAccess(fileId, ethers.ZeroAddress, "blob", 0)
      ).to.be.revertedWith("FileRegistry: cannot grant to zero address");
    });

    it("reverts when expiry is in the past", async function () {
      const past = Math.floor(Date.now() / 1000) - 1000;
      await expect(
        fileRegistry.grantAccess(fileId, alice.address, "blob", past)
      ).to.be.revertedWith("FileRegistry: expiry must be in the future");
    });

    it("rejects empty encrypted key blobs", async function () {
      await expect(
        fileRegistry.grantAccess(fileId, alice.address, "", 0)
      ).to.be.revertedWith("FileRegistry: encrypted key blob is required");
    });

    it("updates an existing grant instead of duplicating it", async function () {
      await fileRegistry.grantAccess(fileId, alice.address, "blob1", 0);
      await fileRegistry.grantAccess(fileId, alice.address, "blob2", 0);

      expect(await fileRegistry.getGrantCount(fileId)).to.equal(1);
      const grant = await fileRegistry.getGrant(fileId, 0);
      expect(grant.encryptedKeyBlob).to.equal("blob2");
      expect(await fileRegistry.connect(alice).getFilesSharedWithMe()).to.deep.equal([BigInt(1)]);
    });

    it("does not duplicate sharedWithMe entries on re-grant", async function () {
      await fileRegistry.grantAccess(fileId, alice.address, "blob1", 0);
      await fileRegistry.grantAccess(fileId, alice.address, "blob2", 0);
      const shared = await fileRegistry.connect(alice).getFilesSharedWithMe();
      expect(shared.length).to.equal(1);
    });
  });

  describe("revokeAccess", function () {
    let fileId;

    beforeEach(async function () {
      await fileRegistry.uploadFile("QmCid", "doc.pdf", "application/pdf", 500);
      fileId = 1;
      await fileRegistry.grantAccess(fileId, alice.address, "blobAlice", 0);
    });

    it("revokes access and emits AccessRevoked", async function () {
      await ethers.provider.send("evm_mine");
      const latest = await ethers.provider.getBlock("latest");
      await expect(fileRegistry.revokeAccess(fileId, alice.address))
        .to.emit(fileRegistry, "AccessRevoked")
        .withArgs(fileId, owner.address, alice.address, latest.timestamp + 1);

      expect(await fileRegistry.hasAccess(fileId, alice.address)).to.equal(false);
    });

    it("reverts when called by a non-owner", async function () {
      await expect(
        fileRegistry.connect(bob).revokeAccess(fileId, alice.address)
      ).to.be.revertedWith("FileRegistry: not the file owner");
    });

    it("reverts when trying to revoke the owner", async function () {
      await expect(
        fileRegistry.revokeAccess(fileId, owner.address)
      ).to.be.revertedWith("FileRegistry: owner always has access");
    });

    it("reverts when no grant exists for the grantee", async function () {
      await expect(
        fileRegistry.revokeAccess(fileId, mallory.address)
      ).to.be.revertedWith("FileRegistry: no access grant found for grantee");
    });

    it("reverts when access is already revoked", async function () {
      await fileRegistry.revokeAccess(fileId, alice.address);
      await expect(
        fileRegistry.revokeAccess(fileId, alice.address)
      ).to.be.revertedWith("FileRegistry: access already revoked");
    });
  });

  describe("hasAccess", function () {
    let fileId;

    beforeEach(async function () {
      await fileRegistry.uploadFile("QmCid", "doc.pdf", "application/pdf", 500);
      fileId = 1;
    });

    it("returns true for the owner", async function () {
      expect(await fileRegistry.hasAccess(fileId, owner.address)).to.equal(true);
    });

    it("returns true after grant and false after revocation", async function () {
      expect(await fileRegistry.hasAccess(fileId, alice.address)).to.equal(false);
      await fileRegistry.grantAccess(fileId, alice.address, "blob", 0);
      expect(await fileRegistry.hasAccess(fileId, alice.address)).to.equal(true);
      await fileRegistry.revokeAccess(fileId, alice.address);
      expect(await fileRegistry.hasAccess(fileId, alice.address)).to.equal(false);
    });

    it("returns false for a grant whose expiry is in the past", async function () {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      await fileRegistry.grantAccess(fileId, alice.address, "blob", now + 100);
      await ethers.provider.send("evm_increaseTime", [200]);
      await ethers.provider.send("evm_mine");
      expect(await fileRegistry.hasAccess(fileId, alice.address)).to.equal(false);
    });

    it("returns true for a grant whose expiry is in the future", async function () {
      const future = Math.floor(Date.now() / 1000) + 3600;
      await fileRegistry.grantAccess(fileId, alice.address, "blob", future);
      expect(await fileRegistry.hasAccess(fileId, alice.address)).to.equal(true);
    });

    it("returns false for files that do not exist", async function () {
      expect(await fileRegistry.hasAccess(999, owner.address)).to.equal(false);
    });
  });

  describe("getFilesSharedWithMe", function () {
    it("returns files shared with each account", async function () {
      await fileRegistry.uploadFile("QmA", "a.pdf", "application/pdf", 10);
      await fileRegistry.uploadFile("QmB", "b.pdf", "application/pdf", 20);

      await fileRegistry.grantAccess(1, alice.address, "blob1", 0);
      await fileRegistry.grantAccess(1, bob.address, "blob2", 0);
      await fileRegistry.grantAccess(2, alice.address, "blob3", 0);

      const aliceShared = await fileRegistry.connect(alice).getFilesSharedWithMe();
      expect(aliceShared).to.deep.equal([BigInt(1), BigInt(2)]);

      const bobShared = await fileRegistry.connect(bob).getFilesSharedWithMe();
      expect(bobShared).to.deep.equal([BigInt(1)]);
    });

    it("returns empty array for an account with no shares", async function () {
      const malloryShared = await fileRegistry.getFilesSharedWithMe();
      expect(malloryShared.length).to.equal(0);
    });
  });

  describe("getEncryptedKeyFor", function () {
    let fileId;

    beforeEach(async function () {
      await fileRegistry.uploadFile("QmCid", "doc.pdf", "application/pdf", 500);
      fileId = 1;
    });

    it("returns the encrypted key blob for a grantee with access", async function () {
      await fileRegistry.grantAccess(fileId, alice.address, "blobForAlice", 0);
      const key = await fileRegistry.getEncryptedKeyFor(fileId, alice.address);
      expect(key).to.equal("blobForAlice");
    });

    it("reverts when the caller has no access", async function () {
      await expect(
        fileRegistry.getEncryptedKeyFor(fileId, mallory.address)
      ).to.be.revertedWith("FileRegistry: no access");
    });

    it("returns empty string for the owner when no grant exists", async function () {
      const key = await fileRegistry.getEncryptedKeyFor(fileId, owner.address);
      expect(key).to.equal("");
    });
  });

  describe("deactivateFile", function () {
    it("marks a file inactive for the owner", async function () {
      await fileRegistry.uploadFile("QmCid", "doc.pdf", "application/pdf", 500);
      await fileRegistry.deactivateFile(1);
      const file = await fileRegistry.files(1);
      expect(file.isActive).to.equal(false);
    });

    it("reverts for a non-owner", async function () {
      await fileRegistry.uploadFile("QmCid", "doc.pdf", "application/pdf", 500);
      await expect(fileRegistry.connect(bob).deactivateFile(1)).to.be.revertedWith(
        "FileRegistry: not the file owner"
      );
    });
  });

  // ------------------------------------------------------------------
  // Helpers (placeholder removed — timestamps captured inline above)
  // ------------------------------------------------------------------
});
