export type BrowserStateRepository<T> = {
  load: () => T
  save: (value: T) => void
  clear: () => void
}

export function createBrowserStateRepository<T>(key: string, fallback: () => T): BrowserStateRepository<T> {
  return {
    load() {
      try {
        const raw = localStorage.getItem(key)
        if (!raw) return fallback()
        return JSON.parse(raw) as T
      } catch {
        localStorage.removeItem(key)
        return fallback()
      }
    },
    save(value) {
      localStorage.setItem(key, JSON.stringify(value))
    },
    clear() {
      localStorage.removeItem(key)
    },
  }
}
