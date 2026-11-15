import { Script, fetch } from "scripting"
import { checkTarget, checkForUpdates, fetchUpdateSnapshot, invalidateUpdateState } from "../utils/update_check"
import { BATCH_CHECK_BYTES, BATCH_CHECK_MS } from "../utils/update_engine"

async function main(): Promise<void> {
  const port = Number(Script.queryParameters.port)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("需要本机测试服务器端口")
  const base = `http://127.0.0.1:${port}`
  const budget = () => ({ remaining: BATCH_CHECK_BYTES, deadline: Date.now() + BATCH_CHECK_MS })
  let passed = 0
  const check = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); passed++ }
  const initialStats = await (await fetch(`${base}/stats`, { timeout: 3 })).json()
  const first = await fetchUpdateSnapshot(`${base}/file`, {}, budget())
  check(first.status === 200 && !!first.bytes?.length && first.etag === '"fixture-v1"', "原生 GET/流读取/ETag")
  const second = await fetchUpdateSnapshot(`${base}/file`, { etag: first.etag }, budget())
  check(second.status === 304 && !second.bytes, "真实条件 GET 返回 304 且不读正文")
  const large = await fetchUpdateSnapshot(`${base}/large`, {}, budget())
  check(!!large.reason && !large.bytes, "超大 Content-Length 在正文读取前拒绝")
  const path = `${FileManager.temporaryDirectory}/surge-check-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}.list`
  let created = false
  try {
    await FileManager.writeAsString(path, "DOMAIN,fixture.invalid,DIRECT\n")
    created = true
    const actualStat = await FileManager.stat(path)
    console.log(JSON.stringify({ actualStat, sizeType: typeof actualStat.size, dateType: typeof actualStat.modificationDate }))
    const before = Crypto.sha256(await FileManager.readAsData(path)).toHexString()
    const target = checkTarget(path, `${base}/file`, "rule")
    const result = (await checkForUpdates([target]))[path]
    check(result.state === "current", `真实正文和本地 SHA256 比对：${result.detail}`)
    const cached = (await checkForUpdates([target]))[path]
    check(cached.state === "current" && cached.cached === true, "真实 Storage 缓存命中")
    const after = Crypto.sha256(await FileManager.readAsData(path)).toHexString()
    check(before === after, "检查不修改本地文件")
    const stats = await (await fetch(`${base}/stats`, { timeout: 3 })).json()
    check(stats.file - initialStats.file === 3 && stats.conditional - initialStats.conditional === 1 && stats.large - initialStats.large === 1, "重复检查未增加请求次数")
  } finally {
    invalidateUpdateState(path, "rule")
    if (created) await FileManager.remove(path)
  }
  Script.exit({ passed, scope: "本机 HTTP + Scripting 原生请求/流/哈希/文件/缓存；不使用用户来源和书签" })
}
main().catch(error => { console.error(error); Script.exit({ failed: true, message: error instanceof Error ? error.message : String(error) }) })
