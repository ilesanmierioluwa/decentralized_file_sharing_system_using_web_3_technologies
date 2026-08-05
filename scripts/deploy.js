const hre = require("hardhat");

async function main() {
  const network = hre.network.name;

  console.log(`\n=== Deploying FileRegistry to network: ${network} ===`);

  const FileRegistry = await hre.ethers.getContractFactory("FileRegistry");
  const fileRegistry = await FileRegistry.deploy();
  await fileRegistry.waitForDeployment();

  const address = await fileRegistry.getAddress();
  console.log(`FileRegistry deployed to: ${address}`);
  console.log(`Block explorer: https://${network === "sepolia" ? "sepolia." : ""}etherscan.io/address/${address}`);

  // Write the deployed address to frontend/.env.deployed so the frontend can use it
  try {
    const fs = require("fs");
    const path = require("path");
    const target = path.join(__dirname, "..", "frontend", ".env.deployed");
    const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    const newContent = `VITE_CONTRACT_ADDRESS=${address}\nVITE_CHAIN_ID=${network === "sepolia" ? "11155111" : "1337"}\n`;
    fs.writeFileSync(target, existing.replace(/VITE_CONTRACT_ADDRESS=.*\n?/, "").replace(/VITE_CHAIN_ID=.*\n?/, "") + newContent);
    console.log(`Wrote contract address to frontend/.env.deployed`);
  } catch (err) {
    console.warn(`Could not write frontend/.env.deployed: ${err.message}`);
  }

  return address;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
