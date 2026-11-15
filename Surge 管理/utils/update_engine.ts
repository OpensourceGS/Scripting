import type { ResourceKind } from "./resource_policy"

export type UpdateState = "noSource" | "unchecked" | "current" | "available" | "unknown" | "error"
export type UpdateStatus = { state: UpdateState; detail: string; checkedAt: number; cached?: boolean }
export type CheckTarget = { path: string; link: string; kind: ResourceKind; variant: string }
export type LocalStamp = { key: string; size: number }
export type Validator = { etag?: string; modified?: string }
export type UpdateRecord = UpdateStatus & Validator & { link: string; variant: string; stamp: string }
export type RemoteSnapshot = Validator & { status: number; bytes?: Uint8Array; reason?: string; deferred?: boolean }
export type CheckBudget = { remaining: number; deadline: number }
export type CheckPorts = {
  now: () => number
  stat: (path: string) => Promise<LocalStamp>
  read: (path: string) => Promise<Uint8Array>
  digest: (bytes: Uint8Array, target: CheckTarget) => string
  request: (url: string, validator: Validator, budget: CheckBudget) => Promise<RemoteSnapshot>
}
export const CHECK_TTL = 5 * 60 * 1000
export const ERROR_TTL = 60 * 1000
export const MAX_CHECK_BYTES = 1024 * 1024
export const BATCH_CHECK_BYTES = 8 * 1024 * 1024
export const BATCH_CHECK_MS = 30 * 1000

export function canonicalPath(path: string): string { return path.replace(/^\/private\/var\//, "/var/") }
export function cacheKey(target: CheckTarget): string { return `${target.kind}:${canonicalPath(target.path)}` }
export function baseStatus(link: string): UpdateStatus {
  return link.trim() ? { state: "unchecked", detail: "点击刷新检查来源", checkedAt: 0 }
    : { state: "noSource", detail: "未绑定更新来源", checkedAt: 0 }
}
export function isFresh(record: UpdateRecord, now: number): boolean {
  const age = now - record.checkedAt
  return age >= 0 && age < (record.state === "error" ? ERROR_TTL : CHECK_TTL)
}
export function matchesRecord(record: UpdateRecord | undefined, target: CheckTarget, stamp: LocalStamp): record is UpdateRecord {
  return !!record && record.link === target.link.trim() && record.variant === target.variant && record.stamp === stamp.key
}
export function statusLabel(status: UpdateStatus): string {
  return ({ noSource: "无来源", unchecked: "未检查", current: "与来源一致", available: "有更新", unknown: "待确认", error: "检查失败" })[status.state]
}

// 只忽略管理器维护的元数据，不忽略规则正文或任意注释。
export function comparableModule(text: string, prefixes: string[]): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n")
    .filter(line => !/^\s*#!\s*(?:category|cagegory|local)\s*=/i.test(line)
      && !prefixes.some(prefix => prefix.trim().length > 2 && line.trimStart().startsWith("#")
        && line.trimStart().startsWith(prefix) && /^https?:\/\/\S+$/i.test(line.trimStart().slice(prefix.length).trim())))
    .map(line => line.replace(/^(\s*#!\s*name\s*=)🔗/i, "$1"))
    .join("\n")
}

export class UpdateChecker {
  constructor(readonly records: Record<string, UpdateRecord>, private readonly ports: CheckPorts) {}

  async cached(targets: CheckTarget[]): Promise<Record<string, UpdateStatus>> {
    const results: Record<string, UpdateStatus> = Object.create(null)
    for (const target of targets) {
      let status = baseStatus(target.link)
      if (target.link.trim()) {
        try {
          const stamp = await this.ports.stat(target.path)
          const record = this.records[cacheKey(target)]
          if (matchesRecord(record, target, stamp) && isFresh(record, this.ports.now())) status = { ...record, cached: true }
        } catch { status = { state: "unknown", checkedAt: 0, detail: "本地文件暂不可用" } }
      }
      results[target.path] = status
    }
    return results
  }

  async check(targets: CheckTarget[], onResult?: (path: string, status: UpdateStatus, completed: number) => void,
    isCurrent: () => boolean = () => true): Promise<Record<string, UpdateStatus>> {
    const results: Record<string, UpdateStatus> = Object.create(null)
    const budget: CheckBudget = { remaining: BATCH_CHECK_BYTES, deadline: this.ports.now() + BATCH_CHECK_MS }
    // 同一来源及同一条件请求在本轮共享响应，避免重复下载。
    const requests = new Map<string, Promise<RemoteSnapshot>>()
    let cursor = 0
    let completed = 0
    const examine = async (target: CheckTarget): Promise<UpdateStatus> => {
      if (!target.link.trim()) return baseStatus(target.link)
      const key = cacheKey(target)
      let stamp: LocalStamp | undefined
      const save = (status: UpdateStatus, validator: Validator = {}): UpdateStatus => {
        if (stamp && isCurrent()) this.records[key] = { ...status, ...validator, stamp: stamp.key, link: target.link.trim(), variant: target.variant }
        return status
      }
      try {
        stamp = await this.ports.stat(target.path)
        const previous = this.records[key]
        const baseline = matchesRecord(previous, target, stamp) ? previous : undefined
        if (baseline && isFresh(baseline, this.ports.now())) return { ...baseline, cached: true }
        if (stamp.size > MAX_CHECK_BYTES) return save({ state: "unknown", checkedAt: this.ports.now(), detail: "文件超过 1 MiB，省流检查不读取全文；可手动更新" })
        if (!isCurrent() || this.ports.now() >= budget.deadline || budget.remaining <= 0) {
          return { state: "unknown", checkedAt: 0, detail: "本轮检查预算已用完，再次刷新继续" }
        }
        // 304 只能复用已做过内容比对的结果；上次“有更新”不能被翻成“一致”。
        const comparable = baseline && (baseline.state === "current" || baseline.state === "available")
        const validator: Validator = comparable ? { etag: baseline.etag, modified: baseline.modified } : {}
        const requestKey = JSON.stringify([target.link.trim(), validator.etag ?? "", validator.modified ?? ""])
        let request = requests.get(requestKey)
        if (!request) {
          request = this.ports.request(target.link.trim(), validator, budget)
          requests.set(requestKey, request)
        }
        const remote = await request
        if (!isCurrent()) return { state: "unknown", checkedAt: 0, detail: "检查已失效" }
        if ((await this.ports.stat(target.path)).key !== stamp.key) {
          return { state: "unchecked", checkedAt: 0, detail: "检查期间本地文件已变化，请重试" }
        }
        if (remote.status === 304) {
          if (!comparable || (!validator.etag && !validator.modified)) throw new Error("来源返回 304，但缺少可比对的本地基线")
          return save({ state: baseline.state, detail: "来源确认未变化 · 条件请求", checkedAt: this.ports.now() },
            { etag: remote.etag ?? baseline.etag, modified: remote.modified ?? baseline.modified })
        }
        if (remote.reason) {
          const status: UpdateStatus = { state: "unknown", detail: remote.reason, checkedAt: remote.deferred ? 0 : this.ports.now() }
          return remote.deferred ? status : save(status)
        }
        if (remote.status !== 200 || !remote.bytes) throw new Error(`来源响应异常（HTTP ${remote.status}）`)
        if (remote.bytes.length === 0) return save({ state: "unknown", detail: "来源返回空内容，未判断为更新", checkedAt: this.ports.now() })
        const local = await this.ports.read(target.path)
        if (local.length > MAX_CHECK_BYTES || (await this.ports.stat(target.path)).key !== stamp.key) {
          return { state: "unchecked", checkedAt: 0, detail: "本地文件已变化，请重试" }
        }
        const same = this.ports.digest(local, target) === this.ports.digest(remote.bytes, target)
        return save({ state: same ? "current" : "available", checkedAt: this.ports.now(),
          detail: same ? "已比对正文，与来源一致" : "来源正文与本地不同；更新将覆盖本地内容" },
          { etag: remote.etag, modified: remote.modified })
      } catch (error: unknown) {
        return save({ state: "error", checkedAt: this.ports.now(), detail: error instanceof Error ? error.message : "检查未完成" })
      }
    }
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor++
        if (index >= targets.length || !isCurrent()) return
        const target = targets[index]
        const status = await examine(target)
        results[target.path] = status
        completed += 1
        if (isCurrent()) onResult?.(target.path, status, completed)
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker))
    return results
  }
}
