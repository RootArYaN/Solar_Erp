import { access, readdir } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const distRoot = path.join(frontendRoot, "dist")
const wranglerConfig = path.join(frontendRoot, "wrangler.jsonc")
const staticBucket = "shree-enterprise-static"
const privateFilesBucket = "shree-enterprise-files"
const wranglerBin = path.join(
  frontendRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
)

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
])

function runWrangler(args, { allowFailure = false } = {}) {
  const result = spawnSync(
    wranglerBin,
    [...args, "--config", wranglerConfig],
    {
      cwd: frontendRoot,
      env: { ...process.env, CI: "true" },
      stdio: allowFailure ? "ignore" : "inherit",
    },
  )
  if (!allowFailure && result.status !== 0) {
    throw new Error(`Wrangler failed with exit code ${result.status ?? "unknown"}`)
  }
  return result.status === 0
}

function ensureBucket(name) {
  if (runWrangler(["r2", "bucket", "info", name, "--json"], { allowFailure: true })) {
    return
  }
  runWrangler(["r2", "bucket", "create", name])
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const output = []
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await filesUnder(absolute))
    else if (entry.isFile()) output.push(absolute)
  }
  return output
}

await access(distRoot)
await access(wranglerBin)

ensureBucket(staticBucket)
ensureBucket(privateFilesBucket)

const files = await filesUnder(distRoot)
for (const file of files) {
  const key = path.relative(distRoot, file).split(path.sep).join("/")
  const contentType = contentTypes.get(path.extname(file).toLowerCase()) ?? "application/octet-stream"
  const cacheControl = key === "index.html"
    ? "public, max-age=0, must-revalidate"
    : key.startsWith("assets/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600"
  runWrangler([
    "r2",
    "object",
    "put",
    `${staticBucket}/${key}`,
    "--file",
    file,
    "--content-type",
    contentType,
    "--cache-control",
    cacheControl,
    "--remote",
    "--force",
  ])
}

runWrangler(["deploy"])
console.log(`Uploaded ${files.length} static assets and deployed shree-enterprise-web.`)
