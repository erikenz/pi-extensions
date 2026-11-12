#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import * as p from "@clack/prompts";
import pc from "picocolors";

const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const repoRoot = path.resolve(__dirname, "..");
const packagesDir = path.join(repoRoot, "packages");
const settingsPath = path.join(os.homedir(), ".config/pi/agent/settings.json");
const npmModulesDir = path.join(
  os.homedir(),
  ".config/pi/agent/npm/node_modules"
);
const globalExtDir = path.join(os.homedir(), ".config/pi/agent/extensions");

interface ExtensionItem {
  value: string;
  label: string;
  hint?: string;
  name: string;
}

const isRecord = (val: unknown): val is Record<string, unknown> =>
  typeof val === "object" && val !== null && !Array.isArray(val);

const parseJsonObjectSafe = (text: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
};

const getStringProp = (
  obj: Record<string, unknown> | null,
  key: string
): string => {
  if (obj !== null && typeof obj[key] === "string" && obj[key].length > 0) {
    return obj[key];
  }
  return "";
};

const getStringArrayProp = (
  obj: Record<string, unknown> | null,
  key: string
): string[] => {
  if (obj !== null && Array.isArray(obj[key])) {
    return obj[key].filter((item): item is string => typeof item === "string");
  }
  return [];
};

// 1. Collect Monorepo Packages
const monorepoPackages: ExtensionItem[] = [];
const monorepoNames = new Set<string>();

if (fs.existsSync(packagesDir)) {
  const dirs = fs.readdirSync(packagesDir, { withFileTypes: true });
  for (const dir of dirs) {
    if (!dir.isDirectory()) {
      continue;
    }
    const pkgJsonPath = path.join(packagesDir, dir.name, "package.json");
    if (!fs.existsSync(pkgJsonPath)) {
      continue;
    }

    const raw = fs.readFileSync(pkgJsonPath, "utf-8");
    const pkgJson = parseJsonObjectSafe(raw);
    if (pkgJson === null) {
      continue;
    }

    const parsedName = getStringProp(pkgJson, "name");
    const pkgName = parsedName.length > 0 ? parsedName : dir.name;
    const parsedVer = getStringProp(pkgJson, "version");
    const version = parsedVer.length > 0 ? `v${parsedVer}` : "local";
    const parsedDesc = getStringProp(pkgJson, "description");
    const desc = parsedDesc.length > 0 ? ` • ${parsedDesc}` : "";

    monorepoNames.add(dir.name);
    if (parsedName.length > 0) {
      monorepoNames.add(parsedName);
      monorepoNames.add(parsedName.replace(/^@[^/]+\//u, ""));
    }

    const extEntry = path.join(packagesDir, dir.name, "extensions", "index.ts");
    const targetPath = fs.existsSync(extEntry)
      ? extEntry
      : path.join(packagesDir, dir.name);

    monorepoPackages.push({
      hint: `${version}${desc}`,
      label: dir.name,
      name: pkgName,
      value: targetPath,
    });
  }
}

// 2. Collect Installed Pi Extensions (excluding monorepo duplicates)
const installedExtensions: ExtensionItem[] = [];

if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath, "utf-8");
  const settings = parseJsonObjectSafe(raw);
  const packages = getStringArrayProp(settings, "packages");

  for (const item of packages) {
    const cleanName = item.replace(/^npm:/u, "");
    const bareName = cleanName.replace(/^@[^/]+\//u, "");

    if (monorepoNames.has(cleanName) || monorepoNames.has(bareName)) {
      continue;
    }

    const pkgPath = path.join(npmModulesDir, cleanName);
    if (fs.existsSync(pkgPath)) {
      let version = "installed";
      let desc = "";
      const pkgRawPath = path.join(pkgPath, "package.json");
      if (fs.existsSync(pkgRawPath)) {
        const pkgRaw = fs.readFileSync(pkgRawPath, "utf-8");
        const pkgJson = parseJsonObjectSafe(pkgRaw);
        const parsedVer = getStringProp(pkgJson, "version");
        if (parsedVer.length > 0) {
          version = `v${parsedVer}`;
        }
        const parsedDesc = getStringProp(pkgJson, "description");
        if (parsedDesc.length > 0) {
          desc = ` • ${parsedDesc}`;
        }
      }

      const extEntry = path.join(pkgPath, "extensions", "index.ts");
      const target = fs.existsSync(extEntry) ? extEntry : pkgPath;

      installedExtensions.push({
        hint: `${version}${desc}`,
        label: cleanName,
        name: cleanName,
        value: target,
      });
    }
  }
}

if (fs.existsSync(globalExtDir)) {
  const files = fs.readdirSync(globalExtDir);
  for (const file of files) {
    if (!file.endsWith(".ts") && !file.endsWith(".js")) {
      continue;
    }
    const baseName = file.replace(/\.(?<ext>ts|js)$/u, "");
    if (monorepoNames.has(baseName)) {
      continue;
    }

    installedExtensions.push({
      hint: "global extension file",
      label: file,
      name: file,
      value: path.join(globalExtDir, file),
    });
  }
}

if (monorepoPackages.length === 0) {
  console.error(pc.red(`No packages found under ${packagesDir}`));
  process.exit(1);
}

const main = async (): Promise<void> => {
  p.updateSettings({
    aliases: {
      "\u0003": "cancel",
      escape: "cancel",
      h: "left",
      j: "down",
      k: "up",
      l: "right",
      q: "cancel",
    },
  });

  p.intro(
    `${pc.bold(pc.cyan("Pi Dev Launcher"))} ${pc.dim("• Isolated Session (-ne)")}`
  );

  const groups: Record<
    string,
    { value: string; label: string; hint?: string }[]
  > = {
    [pc.bold("Monorepo Packages (local)")]: monorepoPackages.map((pkg) => ({
      hint: pkg.hint,
      label: pkg.label,
      value: pkg.value,
    })),
  };

  if (installedExtensions.length > 0) {
    groups[pc.bold("Installed Pi Extensions (optional)")] =
      installedExtensions.map((ext) => ({
        hint: ext.hint,
        label: ext.label,
        value: ext.value,
      }));
  }

  const defaultSelected = monorepoPackages.map((pkg) => pkg.value);

  const selected = await p.groupMultiselect<string>({
    initialValues: defaultSelected,
    message: "Select extensions to load into Pi:",
    options: groups,
    required: false,
    selectableGroups: true,
  });

  if (p.isCancel(selected)) {
    p.cancel("Launch canceled.");
    process.exit(0);
  }

  const selectedPaths = selected;

  const selectedMono = monorepoPackages.filter((m) =>
    selectedPaths.includes(m.value)
  );
  const selectedInst = installedExtensions.filter((i) =>
    selectedPaths.includes(i.value)
  );

  const summaryLines = [
    `${pc.cyan("Monorepo packages:")} ${
      selectedMono.length > 0
        ? selectedMono.map((m) => pc.green(m.label)).join(", ")
        : pc.dim("none")
    }`,
    `${pc.cyan("Installed extensions:")} ${
      selectedInst.length > 0
        ? selectedInst.map((i) => pc.green(i.label)).join(", ")
        : pc.dim("none")
    }`,
  ];

  p.note(summaryLines.join("\n"), "Configured Sandbox");
  p.outro(pc.green("Starting Pi in isolated mode..."));

  const piArgs = ["-ne"];
  for (const pth of selectedPaths) {
    piArgs.push("-e", pth);
  }

  const forwardArgs = process.argv.slice(2);
  piArgs.push(...forwardArgs);

  const res = spawnSync("pi", piArgs, {
    env: process.env,
    stdio: "inherit",
  });

  process.exit(res.status ?? 0);
};

void main();
