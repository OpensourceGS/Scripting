import { type DownloadProgress } from "./stream_downloader"

export type BatchItem = {
  name: string
  state: "waiting" | "active" | "succeeded" | "failed" | "skipped"
  received: number
  total?: number
  fraction: number
}
export type BatchSnapshot = {
  total: number
  active: number
  completed: number
  succeeded: number
  failed: number
  skipped: number
  fraction: number
  received: number
  unknown: number
  items: BatchItem[]
}
export type BatchResult = { succeeded: number; failed: number; skipped: number; errors: string[] }

// File-equal queue estimate, not a byte-weighted network percentage. Unknown
// lengths contribute only on settlement; known byte fractions reserve 5% for writing.
export async function runBatchPool<T>(
  files: readonly T[],
  concurrency: number,
  nameOf: (file: T) => string,
  download: (file: T, progress: (value: DownloadProgress) => void) => Promise<string | null>,
  onChange: (snapshot: BatchSnapshot) => void,
  now: () => number = Date.now
): Promise<BatchResult> {
  const items: BatchItem[] = files.map((file: T): BatchItem => ({ name: nameOf(file), state: "waiting", received: 0, fraction: 0 }))
  const result: BatchResult = { succeeded: 0, failed: 0, skipped: 0, errors: [] }
  let next: number = 0
  let lastEmit: number = -Infinity
  let overall: number = 0
  function publish(force: boolean): void {
    const time: number = now()
    if (!force && time - lastEmit < 150) return
    lastEmit = time
    overall = Math.max(overall, items.length ? items.reduce((sum: number, item: BatchItem): number => sum + item.fraction, 0) / items.length : 1)
    const snapshot: BatchSnapshot = {
      total: items.length,
      active: items.filter((item: BatchItem): boolean => item.state === "active").length,
      completed: result.succeeded + result.failed + result.skipped,
      succeeded: result.succeeded, failed: result.failed, skipped: result.skipped,
      fraction: overall,
      received: items.reduce((sum: number, item: BatchItem): number => sum + item.received, 0),
      unknown: items.filter((item: BatchItem): boolean => item.total === undefined).length,
      items: items.map((item: BatchItem): BatchItem => ({ ...item })),
    }
    // A presentation failure must not reject a worker and leave downloads unawaited.
    try { onChange(snapshot) } catch { /* Transfer result is independent of UI observers. */ }
  }
  async function worker(): Promise<void> {
    for (;;) {
      const index: number = next++
      if (index >= files.length) return
      const item: BatchItem = items[index]
      item.state = "active"
      publish(true)
      try {
        const path: string | null = await download(files[index], (value: DownloadProgress): void => {
          if (item.state !== "active") return // Ignore late events from completed/retried tasks.
          if (Number.isFinite(value.received)) item.received = Math.max(item.received, value.received, 0)
          if (typeof value.total === "number" && Number.isFinite(value.total) && value.total > 0) item.total = value.total
          if (item.total !== undefined) item.fraction = Math.max(item.fraction, Math.min(0.95, item.received / item.total * 0.95))
          publish(false)
        })
        if (path) { item.state = "succeeded"; result.succeeded += 1 }
        else { item.state = "skipped"; result.skipped += 1 }
      } catch (error: unknown) {
        item.state = "failed"
        result.failed += 1
        result.errors.push(`${item.name}：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        item.fraction = 1
        publish(true)
      }
    }
  }
  publish(true)
  const limit: number = Math.min(files.length, Math.max(1, Math.min(10, Number.isFinite(concurrency) ? Math.round(concurrency) : 3)))
  const workers: Promise<void>[] = Array.from({ length: limit }, (): Promise<void> => worker())
  // Only the bounded worker array is awaited, never one Promise per file.
  await Promise.allSettled(workers)
  publish(true)
  return result
}
