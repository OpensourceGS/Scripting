import { AbortController, fetch } from "scripting"
import { loadConfig } from "./config"
import { validateURL, type ResourceKind } from "./resource_policy"
import { UpdateChecker, MAX_CHECK_BYTES, comparableModule, cacheKey, type CheckTarget, type UpdateStatus, type UpdateRecord, type CheckBudget, type Validator, type RemoteSnapshot, type LocalStamp } from "./update_engine"
export { baseStatus, statusLabel, type UpdateStatus, type CheckTarget } from "./update_engine"

const CACHE_KEY = "surge_resource_update_checks_v1"

export function checkTarget(path: string, link: string, kind: ResourceKind, prefixText?: string): CheckTarget {
  const prefixes = kind === "module" ? (prefixText ?? loadConfig().linkPatternsText).split(/\r?\n/).filter(value => value.trim().length > 0) : []
  return { path, link, kind, variant: JSON.stringify([2, kind, prefixes]) }
}

function loadRecords(): Record<string, UpdateRecord> {
  const result: Record<string, UpdateRecord> = Object.create(null)
  let raw: unknown
  try { raw = Storage.get<unknown>(CACHE_KEY) } catch { return result }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue
    const record = value as Partial<UpdateRecord>
    if (typeof record.link !== "string" || typeof record.stamp !== "string" || typeof record.variant !== "string"
      || typeof record.checkedAt !== "number" || !Number.isFinite(record.checkedAt) || typeof record.detail !== "string"
      || !["current", "available", "unknown", "error"].includes(record.state ?? "")) continue
    result[key] = { ...record, etag: typeof record.etag === "string" ? record.etag : undefined,
      modified: typeof record.modified === "string" ? record.modified : undefined } as UpdateRecord
  }
  return result
}

async function localStamp(path: string): Promise<LocalStamp> {
  if (await FileManager.isLink(path) || !(await FileManager.isFile(path))) throw new Error("本地目标不是普通文件，停止检查")
  const stat = await FileManager.stat(path)
  // 当前原生实测 stat.type 为 NSFileTypeRegular，而文档写 file；用 isFile 判类型。
  if (!Number.isFinite(stat.size) || !Number.isFinite(stat.modificationDate)) throw new Error("本地文件暂不可用")
  return { size: stat.size, key: `${stat.creationDate}:${stat.modificationDate}:${stat.size}` }
}

function digest(bytes: Uint8Array, target: CheckTarget): string {
  if (!bytes.length) return "empty"
  let data = Data.fromUint8Array(bytes)
  if (!data) throw new Error("文件数据无法读取")
  if (target.kind === "module") {
    const text = data.toRawString()
    if (text === null) throw new Error("模块不是可比对的 UTF-8 文本")
    const prefixes = (JSON.parse(target.variant) as [number, string, string[]])[2]
    const normalized = comparableModule(text, prefixes)
    if (!normalized) return "empty"
    data = Data.fromString(normalized)
    if (!data) throw new Error("模块正文无法读取")
  }
  return Crypto.sha256(data).toHexString()
}

export async function fetchUpdateSnapshot(url: string, validator: Validator, budget: CheckBudget): Promise<RemoteSnapshot> {
  validateURL(url)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(8000, budget.deadline - Date.now())))
  try {
    const headers: Record<string, string> = { "Cache-Control": "no-cache" }
    if (validator.etag) headers["If-None-Match"] = validator.etag
    else if (validator.modified) headers["If-Modified-Since"] = validator.modified
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal, timeout: 8 })
    const metadata: Validator = { etag: response.headers.get("etag") ?? undefined, modified: response.headers.get("last-modified") ?? undefined }
    if (response.status === 304) return { status: 304, ...metadata }
    if (response.status !== 200) throw new Error(`来源响应异常（HTTP ${response.status}）`)
    const type = response.headers.get("content-type") ?? ""
    if (/text\/html/i.test(type)) return { status: 200, reason: "来源返回网页，无法确认文件更新" }
    const lengthText = response.headers.get("content-length")
    const length = lengthText === null ? NaN : Number(lengthText)
    if (Number.isFinite(length) && length > MAX_CHECK_BYTES) return { status: 200, reason: "来源超过 1 MiB，省流检查不读取全文；可手动更新" }
    if (Number.isFinite(length) && length > budget.remaining) return { status: 200, deferred: true, reason: "本轮流量预算不足，再次刷新继续检查" }
    const reader = response.body.getReader()
    const parts: Uint8Array[] = []
    let received = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        received += value.length
        budget.remaining -= value.length
        if (received > MAX_CHECK_BYTES) return { status: 200, reason: "已到单文件 1 MiB 检查上限，未继续读取正文" }
        if (budget.remaining < 0) return { status: 200, deferred: true, reason: "本轮流量预算用完，再次刷新继续检查" }
        parts.push(value)
      }
    } finally {
      try { await reader.cancel() } catch { /* 完成或取消后均释放流。 */ }
    }
    const bytes = new Uint8Array(received)
    let offset = 0
    for (const part of parts) { bytes.set(part, offset); offset += part.length }
    return { status: 200, bytes, ...metadata }
  } catch (error: unknown) {
    if (controller.signal.aborted) throw new Error("检查超时，本次未判断为更新")
    // 不把带令牌的 URL 拼入界面错误或日志。
    if (error instanceof Error && error.message.startsWith("来源响应异常")) throw error
    throw new Error("网络检查失败，请稍后刷新")
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

function checker(): UpdateChecker {
  return new UpdateChecker(loadRecords(), { now: Date.now, stat: localStamp,
    read: path => FileManager.readAsBytes(path), digest, request: fetchUpdateSnapshot })
}

export async function cachedUpdateStates(targets: CheckTarget[]): Promise<Record<string, UpdateStatus>> {
  return checker().cached(targets)
}

export async function checkForUpdates(targets: CheckTarget[], onResult?: (path: string, status: UpdateStatus, completed: number) => void,
  isCurrent: () => boolean = () => true): Promise<Record<string, UpdateStatus>> {
  const engine = checker()
  const initial = { ...engine.records }
  const results = await engine.check(targets, onResult, isCurrent)
  if (isCurrent()) {
    const latest = loadRecords()
    for (const [key, record] of Object.entries(engine.records)) {
      if (record === initial[key]) continue
      // 检查期间已被删除/替换的旧记录不能复活；不同检查的新结果也不覆盖。
      if (JSON.stringify(latest[key]) !== JSON.stringify(initial[key])) continue
      latest[key] = record
    }
    // 单次批量写缓存，只保留最近 600 条；Storage 不提供跨进程原子事务。
    const records = Object.fromEntries(Object.entries(latest).sort((a, b) => b[1].checkedAt - a[1].checkedAt).slice(0, 600))
    try { Storage.set(CACHE_KEY, records) } catch { /* 缓存不可用不改变本轮真实结果。 */ }
  }
  return results
}

export function invalidateUpdateState(path: string, kind: ResourceKind): void {
  try {
    const records = loadRecords()
    delete records[cacheKey({ path, kind, link: "", variant: "" })]
    Storage.set(CACHE_KEY, records)
  } catch { /* 可选缓存不可用时，不能把已完成的文件保存报成失败。 */ }
}

export function updateSummary(statuses: UpdateStatus[]): string {
  const count = (state: UpdateStatus["state"]): number => statuses.filter(value => value.state === state).length
  return `有更新 ${count("available")} · 一致 ${count("current")} · 待确认 ${count("unknown") + count("error") + count("unchecked")} · 无来源 ${count("noSource")}`
}
