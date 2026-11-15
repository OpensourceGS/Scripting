import { Script } from "scripting"
import {
  UpdateChecker, CHECK_TTL, ERROR_TTL, MAX_CHECK_BYTES, BATCH_CHECK_BYTES,
  BATCH_CHECK_MS, cacheKey, comparableModule,
  type CheckPorts, type CheckTarget, type LocalStamp, type Validator,
  type RemoteSnapshot, type CheckBudget, type UpdateRecord,
} from "../utils/update_engine"
import { validateURL, validateFileName } from "../utils/resource_policy"

// 刻意不导入 update_check：其真实网络、Storage 与 FileManager 不进入测试。
// URL 均为保留的 .invalid 域名；request/read/stat/digest 全由内存替身提供。
type Case = { name: string; run: () => void | Promise<void> }
const cases: Case[] = []
function test(name: string, run: Case["run"]): void { cases.push({ name, run }) }
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
function equal(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}：实际 ${String(actual)}，预期 ${String(expected)}`)
}
function bytes(value: string): Uint8Array {
  const encoded = encodeURIComponent(value).match(/%[0-9A-F]{2}|./g) ?? []
  return Uint8Array.from(encoded.map(part => part[0] === "%" ? parseInt(part.slice(1), 16) : part.charCodeAt(0)))
}
function text(value: Uint8Array): string {
  return decodeURIComponent(Array.from(value, n => `%${n.toString(16).padStart(2, "0")}`).join(""))
}
function target(path = "/mock/a.list", link = "https://source.invalid/rules"): CheckTarget {
  return { path, link, kind: "rule", variant: "rule-v1" }
}
function rig() {
  let now = 1_000_000
  const files = new Map<string, { stamp: LocalStamp; bytes: Uint8Array }>()
  const records: Record<string, UpdateRecord> = Object.create(null)
  const calls: { url: string; validator: Validator; budget: CheckBudget }[] = []
  let reads = 0
  let stats = 0
  let reply: CheckPorts["request"] = async () => ({ status: 200, bytes: bytes("local"), etag: '"v1"' })
  const ports: CheckPorts = {
    now: () => now,
    stat: async path => {
      stats += 1
      const file = files.get(path)
      if (!file) throw new Error("mock 本地文件不存在")
      return { ...file.stamp }
    },
    read: async path => {
      reads += 1
      const file = files.get(path)
      if (!file) throw new Error("mock 本地文件不存在")
      return file.bytes.slice()
    },
    // 测试状态机而非 Crypto；无碰撞的正文字符串即可作为测试摘要。
    digest: (value, item) => item.kind === "module"
      ? comparableModule(text(value), JSON.parse(item.variant) as string[]) : text(value),
    request: async (url, validator, budget) => {
      calls.push({ url, validator: { ...validator }, budget })
      return reply(url, validator, budget)
    },
  }
  const checker = new UpdateChecker(records, ports)
  const put = (item: CheckTarget, body = "local", stamp = "s1", size?: number): void => {
    const value = bytes(body)
    files.set(item.path, { stamp: { key: stamp, size: size ?? value.length }, bytes: value })
  }
  const seed = (item: CheckTarget, state: "current" | "available" = "current", validator: Validator = { etag: '"v1"' }): void => {
    const file = files.get(item.path)
    assert(file, "seed 需要本地文件")
    records[cacheKey(item)] = { state, detail: "已有正文基线", checkedAt: now,
      link: item.link.trim(), variant: item.variant, stamp: file.stamp.key, ...validator }
  }
  const check = async (item: CheckTarget) => (await checker.check([item]))[item.path]
  return { checker, records, files, calls, put, seed, check,
    advance: (ms: number) => { now += ms },
    respond: (fn: CheckPorts["request"]) => { reply = fn },
    reads: () => reads, stats: () => stats, now: () => now }
}

test("首次正文一致：建立 current 及同响应 validator", async () => {
  const r = rig(), t = target(); r.put(t)
  const status = await r.check(t)
  equal(status.state, "current", "正文一致")
  equal(r.calls.length, 1, "首次请求一次")
  equal(r.calls[0].validator.etag, undefined, "首次不得发 ETag")
  equal(r.calls[0].validator.modified, undefined, "首次不得发时间条件")
  equal(r.records[cacheKey(t)].etag, '"v1"', "保存同响应 ETag")
  equal(r.records[cacheKey(t)].stamp, "s1", "绑定本地 stamp")
})
test("首次正文不同：建立 available 而非 current", async () => {
  const r = rig(), t = target(); r.put(t, "old")
  equal((await r.check(t)).state, "available", "正文不同")
  equal(r.records[cacheKey(t)].etag, '"v1"', "基线是已比较的远端版本")
})
test("available 过期收到 304：保持有更新，后续缓存也保持", async () => {
  const r = rig(), t = target(); r.put(t, "old"); await r.check(t)
  r.advance(CHECK_TTL)
  r.respond(async () => ({ status: 304, modified: "Wed, 01 Jan 2025 00:00:00 GMT" }))
  equal((await r.check(t)).state, "available", "304 不得变成一致")
  equal(r.calls[1].validator.etag, '"v1"', "条件来自已比对响应")
  equal(r.records[cacheKey(t)].etag, '"v1"', "304 缺省 ETag 保留原值")
  equal((await r.check(t)).state, "available", "再次读取缓存仍有更新")
  equal(r.calls.length, 2, "缓存不再请求")
})
test("5 分钟内缓存：不请求也不读取正文", async () => {
  const r = rig(), t = target(); r.put(t); r.seed(t)
  r.advance(CHECK_TTL - 1)
  const status = await r.check(t)
  equal(status.state, "current", "复用结果"); equal(status.cached, true, "标记缓存")
  equal(r.calls.length, 0, "没有网络"); equal(r.reads(), 0, "没有正文读取")
  equal((await r.checker.cached([t]))[t.path].state, "current", "cached 入口也复用")
})
test("恰好 5 分钟过期：发 ETag 条件请求", async () => {
  const r = rig(), t = target(); r.put(t); r.seed(t); r.advance(CHECK_TTL)
  r.respond(async () => ({ status: 304 }))
  equal((await r.check(t)).state, "current", "304 保持一致")
  equal(r.calls.length, 1, "过期请求一次"); equal(r.calls[0].validator.etag, '"v1"', "使用基线 ETag")
  equal(r.reads(), 0, "304 不读本地正文")
})
test("只有 Last-Modified 的过期基线仍能条件验证", async () => {
  const r = rig(), t = target(), modified = "Wed, 01 Jan 2025 00:00:00 GMT"
  r.put(t); r.seed(t, "current", { modified }); r.advance(CHECK_TTL)
  r.respond(async () => ({ status: 304 }))
  equal((await r.check(t)).state, "current", "时间条件 304")
  equal(r.calls[0].validator.modified, modified, "传入原始时间")
})
test("本地 stat 变化：旧缓存与旧 validator 同时失效", async () => {
  const r = rig(), t = target(); r.put(t); r.seed(t); r.put(t, "edited", "s2")
  equal((await r.checker.cached([t]))[t.path].state, "unchecked", "旧缓存失效")
  equal((await r.check(t)).state, "available", "重比正文")
  equal(r.calls[0].validator.etag, undefined, "不发旧 ETag")
  equal(r.calls[0].validator.modified, undefined, "不发旧时间")
})
test("URL 变化：同一路径不得使用旧 validator", async () => {
  const r = rig(), old = target(); r.put(old); r.seed(old)
  const changed = { ...old, link: "https://other.invalid/rules" }
  equal((await r.checker.cached([changed]))[changed.path].state, "unchecked", "来源变化缓存失效")
  await r.check(changed)
  equal(r.calls[0].url, changed.link, "请求新来源")
  equal(r.calls[0].validator.etag, undefined, "旧来源验证头失效")
})
test("比较规则 variant 变化：不能使用旧 validator", async () => {
  const r = rig(), t = target(); r.put(t); r.seed(t)
  await r.check({ ...t, variant: "rule-v2" })
  equal(r.calls[0].validator.etag, undefined, "比较算法变化重新校准")
})
test("无来源及全空白来源：0 请求、0 stat、0 read", async () => {
  const r = rig(), targets = [target("/mock/a", ""), target("/mock/b", " \n\t ")]
  const result = await r.checker.check(targets)
  for (const t of targets) equal(result[t.path].state, "noSource", "无来源")
  equal(r.calls.length, 0, "0 请求"); equal(r.stats(), 0, "0 stat"); equal(r.reads(), 0, "0 read")
})
test("网络错误不当 current，错误缓存 1 分钟后才重试", async () => {
  const r = rig(), t = target(); r.put(t); r.seed(t); r.advance(CHECK_TTL)
  r.respond(async () => { throw new Error("mock 网络失败") })
  equal((await r.check(t)).state, "error", "不能保留 current 假象")
  equal(r.records[cacheKey(t)].etag, undefined, "错误结果不保留可用验证头")
  r.advance(ERROR_TTL - 1); equal((await r.check(t)).cached, true, "错误短缓存")
  equal(r.calls.length, 1, "错误短缓存不请求")
  r.advance(1); await r.check(t); equal(r.calls.length, 2, "错误缓存过期重试")
  equal(r.calls[1].validator.etag, undefined, "错误后重新正文校准")
})
test("无基线的意外 304：报错而非 current", async () => {
  const r = rig(), t = target(); r.put(t); r.respond(async () => ({ status: 304 }))
  equal((await r.check(t)).state, "error", "无基线 304 不能使用")
})
test("unknown 即使带旧验证头也不能拿 304 当一致", async () => {
  const r = rig(), t = target(); r.put(t); r.seed(t)
  r.records[cacheKey(t)].state = "unknown"; r.advance(CHECK_TTL)
  r.respond(async () => ({ status: 304 }))
  equal((await r.check(t)).state, "error", "unknown 无正文比对依据")
  equal(r.calls[0].validator.etag, undefined, "未知状态不发条件")
})
test("HTTP 错误、空正文、预算拒绝都不能当 current", async () => {
  const replies: RemoteSnapshot[] = [
    { status: 500 }, { status: 200, bytes: new Uint8Array() },
    { status: 200, reason: "来源内容超过省流检查预算，可手动更新" },
  ]
  for (const reply of replies) {
    const r = rig(), t = target(); r.put(t); r.respond(async () => reply)
    const status = await r.check(t)
    equal(status.state, reply.status === 500 ? "error" : "unknown", "安全降级")
    equal(r.records[cacheKey(t)].etag, undefined, "不建立 validator")
    equal(r.reads(), 0, "无可比正文不读取本地")
  }
})
test("同 URL 同 validator：共享请求但按各自本地正文判断", async () => {
  const r = rig(), a = target(), b = target("/mock/b.list"); r.put(a); r.put(b, "old")
  const result = await r.checker.check([a, b])
  equal(r.calls.length, 1, "无条件请求去重")
  equal(result[a.path].state, "current", "A 一致"); equal(result[b.path].state, "available", "B 有更新")
  r.advance(CHECK_TTL); r.respond(async () => ({ status: 304 }))
  const next = await r.checker.check([a, b])
  equal(r.calls.length, 2, "相同 ETag 条件请求也去重")
  equal(next[a.path].state, "current", "304 保留 A"); equal(next[b.path].state, "available", "304 保留 B")
})
test("同 URL 不同 validator：不能共享 304", async () => {
  const r = rig(), a = target(), b = target("/mock/b.list"); r.put(a); r.put(b)
  r.seed(a, "current", { etag: '"a"' }); r.seed(b, "available", { etag: '"b"' }); r.advance(CHECK_TTL)
  r.respond(async () => ({ status: 304 }))
  const result = await r.checker.check([a, b])
  equal(r.calls.length, 2, "不同条件分别请求")
  equal(result[a.path].state, "current", "A 状态"); equal(result[b.path].state, "available", "B 状态")
})
test("本地大于 1 MiB：跳过网络及全文读取", async () => {
  const r = rig(), t = target(); r.put(t, "x", "s1", MAX_CHECK_BYTES + 1)
  equal((await r.check(t)).state, "unknown", "超限待确认")
  equal(r.calls.length, 0, "超限不请求"); equal(r.reads(), 0, "超限不读取")
})
test("本地恰好 1 MiB：允许校准", async () => {
  const r = rig(), t = target(), value = new Uint8Array(MAX_CHECK_BYTES)
  r.put(t); r.files.set(t.path, { stamp: { key: "limit", size: value.length }, bytes: value })
  r.respond(async () => ({ status: 200, bytes: value }))
  equal((await r.check(t)).state, "current", "边界允许")
  equal(r.calls.length, 1, "边界请求一次")
})
test("stat 后本地变大：不得提交比较结果", async () => {
  const r = rig(), t = target(); r.put(t)
  r.respond(async () => { r.put(t, "changed", "s2", MAX_CHECK_BYTES + 1); return { status: 200, bytes: bytes("local") } })
  equal((await r.check(t)).state, "unchecked", "竞态要求重试")
  equal(r.records[cacheKey(t)], undefined, "不存过期基线")
})
test("共享批次预算耗尽：后续任务不发请求", async () => {
  const r = rig(), targets = Array.from({ length: 5 }, (_, i) => target(`/mock/${i}`, `https://source.invalid/${i}`))
  targets.forEach(t => r.put(t))
  r.respond(async (_url, _validator, budget) => {
    equal(budget.remaining, BATCH_CHECK_BYTES, "初始字节预算")
    equal(budget.deadline, r.now() + BATCH_CHECK_MS, "初始时间预算")
    budget.remaining = 0
    return { status: 200, reason: "mock 预算耗尽" }
  })
  const result = await r.checker.check(targets)
  equal(r.calls.length, 1, "耗尽后不启动新请求")
  targets.forEach(t => equal(result[t.path].state, "unknown", "都不能当一致"))
})
test("共享批次 deadline 过期：后续任务不发请求", async () => {
  const r = rig(), targets = [target(), target("/mock/b", "https://other.invalid/rules")]
  targets.forEach(t => r.put(t))
  r.respond(async () => { r.advance(BATCH_CHECK_MS); return { status: 200, reason: "mock 超时" } })
  const result = await r.checker.check(targets)
  equal(r.calls.length, 1, "到期不启动后续请求")
  equal(result[targets[1].path].state, "unknown", "预算待确认")
})
test("批次预算 deferred：不缓存待确认，下轮立即继续正文校准", async () => {
  const r = rig(), t = target(); r.put(t)
  r.respond(async () => ({ status: 200, deferred: true, reason: "本轮流量预算不足" }))
  const deferred = await r.check(t)
  equal(deferred.state, "unknown", "预算不足不声称一致")
  equal(deferred.checkedAt, 0, "预算延后不标记完成时间")
  equal(r.records[cacheKey(t)], undefined, "不写五分钟 unknown 缓存")
  r.respond(async () => ({ status: 200, bytes: bytes("local"), etag: '\"v2\"' }))
  equal((await r.check(t)).state, "current", "不推进时间即可继续检查")
  equal(r.calls.length, 2, "下一轮实际发请求")
  equal(r.calls[1].validator.etag, undefined, "延后不产生伪 validator")
})
test("本轮检查失效：不保存也不回调", async () => {
  const r = rig(), t = target(); r.put(t); let active = true, callbacks = 0
  r.respond(async () => { active = false; return { status: 200, bytes: bytes("local") } })
  await r.checker.check([t], () => { callbacks += 1 }, () => active)
  equal(callbacks, 0, "失效后无回调"); equal(r.records[cacheKey(t)], undefined, "失效后无写记录")
})
test("comparableModule 仅过滤管理器字段并规范 BOM/CRLF/名称链接标记", () => {
  const source = "#!name=Demo\n#!desc=Keep\n# user comment\n[Rule]\nDOMAIN,a.invalid,DIRECT\n"
  const managed = "\uFEFF#!name=🔗Demo\r\n#!category=Tools\r\n#!cagegory=Old\r\n#!local=true\r\n# managed-source=https://source.invalid\r\n#!desc=Keep\r\n# user comment\r\n[Rule]\r\nDOMAIN,a.invalid,DIRECT\r\n"
  equal(comparableModule(managed, ["# managed-source="]), source, "管理器变更不影响正文")
})
test("comparableModule 保留普通注释、正文、未知元字段和非名称链接符号", () => {
  const base = "#!name=Demo\n#!desc=🔗Keep\n#!author=A\n# comment A\n[Rule]\nDOMAIN,a.invalid,DIRECT\n"
  const compare = (value: string) => comparableModule(value, ["", "# managed-source="])
  equal(compare(base), base, "空前缀不能过滤全部行")
  for (const [before, after] of [["comment A", "comment B"], ["a.invalid", "b.invalid"], ["author=A", "author=B"], ["🔗Keep", "Keep"], ["DIRECT", "REJECT"]]) {
    assert(compare(base) !== compare(base.replace(before, after)), `不能忽略 ${before}`)
  }
  assert(compare(base) !== compare(base + "\n"), "不擅自忽略末尾空行")
})
test("过宽或正文前缀不应隐藏普通内容差异", () => {
  const text = "# user comment\n#!desc=info\nDOMAIN,a.invalid,DIRECT\n#!url=not-a-url\n"
  equal(comparableModule(text, ["#", "#!", "DOMAIN,", "#!url="]), text, "只剥离窄注释前缀下的有效 URL")
})
test("模块正文相同仅管理元数据不同：current；普通注释不同：available", async () => {
  const r = rig(), t: CheckTarget = { ...target(), kind: "module", variant: JSON.stringify(["# managed-source="]) }
  r.put(t, "#!name=🔗Demo\n#!local=true\n# managed-source=https://source.invalid/module\n# user A\n[Rule]")
  r.respond(async () => ({ status: 200, bytes: bytes("#!name=Demo\n# user A\n[Rule]"), etag: '"module1"' }))
  equal((await r.check(t)).state, "current", "仅元数据差异")
  r.advance(CHECK_TTL)
  r.respond(async () => ({ status: 200, bytes: bytes("#!name=Demo\n# user B\n[Rule]"), etag: '"module2"' }))
  equal((await r.check(t)).state, "available", "用户注释差异必须报告")
})
test("resource_policy 对 null/undefined/空白输入给出友好错误", () => {
  for (const value of [null, undefined, "", " \n\t "]) {
    for (const validate of [() => validateURL(value), () => validateFileName(value, "module"), () => validateFileName(value, "rule")]) {
      let caught: unknown
      try { validate() } catch (error: unknown) { caught = error }
      assert(caught instanceof Error, "必须抛出 Error")
      assert(!(caught instanceof TypeError), "不能泄漏 trim TypeError")
      assert(/请输入/.test(caught.message), "提供中文输入提示")
    }
  }
  equal(validateURL(" https://source.invalid/a "), "https://source.invalid/a", "正常 URL 去空白")
  equal(validateFileName(" demo ", "module"), "demo.sgmodule", "正常文件名补后缀")
})

async function main(): Promise<void> {
  const failures: string[] = []
  let passed = 0
  for (const item of cases) {
    try { await item.run(); passed += 1; console.log(`通过：${item.name}`) }
    catch (error: unknown) {
      const message = `${item.name}：${error instanceof Error ? error.message : String(error)}`
      failures.push(message); console.error(`失败：${message}`)
    }
  }
  const result = { passed, failed: failures.length, total: cases.length, failures,
    scope: "仅内存 mock；无真实网络、Storage 或模块文件读写；不覆盖实际 HTTP 流适配层" }
  console.log(JSON.stringify(result))
  // 成败都显式结束；调用方应以 failed 字段判断，避免失败时会话悬挂。
  Script.exit(result)
}
main().catch((error: unknown) => {
  const fatal = error instanceof Error ? error.message : String(error)
  console.error(fatal)
  Script.exit({ failed: 1, fatal })
})
