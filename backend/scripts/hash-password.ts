import bcrypt from "bcryptjs";

// Usage: npm run hash-password -- 'your-password'
const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run hash-password -- '<password>'");
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
console.log("\nADMIN_PASSWORD_HASH=" + hash + "\n");
console.log("Paste the line above into your .env file.");
