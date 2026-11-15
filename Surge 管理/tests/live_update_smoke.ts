import { Script } from "scripting"
import { loadModules } from "../utils/storage"
import { checkTarget, checkForUpdates } from "../utils/update_check"
import { MAX_CHECK_BYTES } from "../utils/update_engine"

// 仅手动运行：检查首个不超过预算的有来源模块；不覆盖文件，不输出来源 URL。
async function main(): Promise<void> {
  const modules = await loadModules()
  for (const module of modules) {
    if (!module.filePath || !/^https?:\/\//i.test(module.link)) continue
    const stat = await FileManager.stat(module.filePath)
    if (stat.size > MAX_CHECK_BYTES) continue
    const before = Crypto.sha256(await FileManager.readAsData(module.filePath)).toHexString()
    const target = checkTarget(module.filePath, module.link, "module")
    const first = (await checkForUpdates([target]))[target.path]
    const second = (await checkForUpdates([target]))[target.path]
    const after = Crypto.sha256(await FileManager.readAsData(module.filePath)).toHexString()
    if (before !== after) throw new Error("测试期间本地原文发生变化，请检查外部写入")
    Script.exit({ state: first.state, detail: first.detail, repeatCached: second.cached === true, localContentUnchanged: true })
    return
  }
  Script.exit({ skipped: true, reason: "没有适合只读检查的有来源模块" })
}
main().catch(error => Script.exit({ error: error instanceof Error ? error.message : "实测未完成" }))
