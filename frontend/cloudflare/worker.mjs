const SECURITY_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
}

function safeObjectKey(pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }

  const parts = decoded.split("/").filter(Boolean)
  if (parts.some((part) => part === "." || part === ".." || part.includes("\\"))) {
    return null
  }
  if (parts.length === 0) return "index.html"
  const key = parts.join("/")
  return decoded.endsWith("/") ? `${key}/index.html` : key
}

function responseHeaders(object, key) {
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set("ETag", object.httpEtag)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value)
  }
  if (!headers.has("Cache-Control")) {
    headers.set(
      "Cache-Control",
      key === "index.html"
        ? "public, max-age=0, must-revalidate"
        : "public, max-age=3600",
    )
  }
  return headers
}

async function findObject(request, bucket) {
  const url = new URL(request.url)
  const requestedKey = safeObjectKey(url.pathname)
  if (!requestedKey) return { error: new Response("Bad request", { status: 400 }) }

  let key = requestedKey
  let object = request.method === "HEAD"
    ? await bucket.head(key)
    : await bucket.get(key)

  const acceptsHtml = request.headers.get("Accept")?.includes("text/html")
  if (!object && acceptsHtml) {
    key = "index.html"
    object = request.method === "HEAD"
      ? await bucket.head(key)
      : await bucket.get(key)
  }
  return { key, object }
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      })
    }

    const result = await findObject(request, env.STATIC_BUCKET)
    if (result.error) return result.error
    if (!result.object) return new Response("Not found", { status: 404 })

    return new Response(request.method === "HEAD" ? null : result.object.body, {
      headers: responseHeaders(result.object, result.key),
    })
  },
}
