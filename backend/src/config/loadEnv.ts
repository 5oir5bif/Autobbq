import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const backendDir = path.resolve(__dirname, "..", "..");
const projectRoot = path.resolve(backendDir, "..");
const rootEnvPath = path.join(projectRoot, ".env");
const backendEnvPath = path.join(backendDir, ".env");

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath });
} else {
  dotenv.config();
}
