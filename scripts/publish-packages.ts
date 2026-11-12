#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const __dirname = import.meta.dirname;
const repoRoot = path.resolve(__dirname, "..");
const packagesDir = path.join(repoRoot, "packages");

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
}

const isRecord = (val: unknown): val is Record<string, unknown> =>
  typeof val === "object" && val !== null && !Array.isArray(val);

const readPackageJson = (dirPath: string): PackageJson | null => {
  const pkgJsonPath = path.join(dirPath, "package.json");
  if (!fs.existsSync(pkgJsonPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(pkgJsonPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }
    if (typeof parsed.name !== "string" || typeof parsed.version !== "string") {
      return null;
    }
    return {
      name: parsed.name,
      private: Boolean(parsed.private),
      version: parsed.version,
    };
  } catch {
    return null;
  }
};

const main = (): void => {
  if (!fs.existsSync(packagesDir)) {
    console.log("No packages directory found.");
    return;
  }

  const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
  const packageDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name));

  let publishedAny = false;

  for (const dir of packageDirs) {
    const pkg = readPackageJson(dir);
    if (!pkg) {
      continue;
    }
    if (pkg.private === true) {
      console.log(`⏩ Skipping private package: ${pkg.name}`);
      continue;
    }

    const spec = `${pkg.name}@${pkg.version}`;
    console.log(`🔍 Checking npm registry for ${spec}...`);

    const check = spawnSync("npm", ["view", spec, "version", "--json"], {
      encoding: "utf-8",
    });

    if (check.status === 0) {
      console.log(`⏩ Skipping ${spec}: already published on npm.`);
      continue;
    }

    console.log(`📦 Publishing ${spec} to npm with provenance...`);
    const pub = spawnSync(
      "pnpm",
      [
        "--filter",
        pkg.name,
        "publish",
        "--provenance",
        "--access",
        "public",
        "--no-git-checks",
      ],
      { stdio: "inherit" }
    );

    if (pub.status !== 0) {
      console.error(`❌ Failed to publish ${spec}`);
      process.exit(pub.status ?? 1);
    }

    publishedAny = true;
  }

  if (publishedAny) {
    console.log("🎉 Successfully published new package versions to npm!");
  } else {
    console.log("✅ All packages are up to date on npm. Nothing to publish.");
  }
};

main();
