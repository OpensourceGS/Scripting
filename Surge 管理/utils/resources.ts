import { Path } from "scripting"
import { invalidateUpdateState } from "./update_check"
import { loadConfig, saveConfig, type AppConfig } from "./config"
import { downloadWithProgress, type DownloadProgress } from "./stream_downloader"
import { isResourceFile, validateFileName, validateURL, type Destination, type ResourceKind } from "./resource_policy"

const RULE_BOOKMARK_KEY: string = "surge_overall_rule_bookmark_v1"
const SOURCES_KEY: string = "surge_overall_sources_v1"
const RULE_SOURCES_KEY: string = "surge_overall_rule_sources_v1"

export type ResourceFile = { name: string; path: string; link: string }
export type DirectoryBookmark = { path: string; bookmarkName: string }

export function savedBookmark(kind: ResourceKind): string {
  return kind === "module" ? loadConfig().baseBookmarkName : Storage.get<string>(RULE_BOOKMARK_KEY) ?? ""
}

export function storeBookmark(kind: ResourceKind, bookmark: DirectoryBookmark): void {
  if (kind === "module") {
    const cfg: AppConfig = loadConfig()
    saveConfig({ ...cfg, baseDir: bookmark.path, baseBookmarkName: bookmark.bookmarkName })
  } else if (!Storage.set(RULE_BOOKMARK_KEY, bookmark.bookmarkName)) {
    throw new Error("分流目录授权保存失败")
  }
}

export async function resolveDirectory(kind: ResourceKind, destination: Destination): Promise<string> {
  // 兼容旧调用的参数，但不再允许访问默认本地目录。
  if (destination !== "surge") throw new Error("本地目录模式已停用，请先在设置中选择书签文件夹")
  const bookmark: string = savedBookmark(kind)
  if (bookmark) {
    const resolved: string | null = FileManager.bookmarkedPath(bookmark)
    if (!resolved) throw new Error("目录授权暂不可用：请检查文件提供商后重试，或重新授权。不会回退到旧路径。")
    if (!(await FileManager.isDirectory(resolved))) throw new Error("授权位置不是文件夹，请重新授权")
    return resolved
  }
  // 旧配置只有路径时，仅匹配已有持久书签；绝不把裸路径当作授权。
  if (kind === "module") {
    const legacy: string = loadConfig().baseDir.replace(/\/+$/, "")
    const bookmarks: { name: string; path: string }[] = FileManager.getAllFileBookmarks()
    const match: { name: string; path: string } | undefined = bookmarks.find((item: { name: string; path: string }): boolean => !!legacy && item.path.replace(/\/+$/, "") === legacy)
    if (match) {
      const resolved: string | null = FileManager.bookmarkedPath(match.name)
      if (resolved && await FileManager.isDirectory(resolved)) {
        storeBookmark(kind, { path: resolved, bookmarkName: match.name })
        return resolved
      }
    }
  }
  throw new Error(`请先独立授权 Surge ${kind === "module" ? "模块" : "分流"}文件夹`)
}

function sourceMap(key: string = SOURCES_KEY): Record<string, string> {
  const raw: unknown = Storage.get<unknown>(key)
  const clean: Record<string, string> = Object.create(null)
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return clean
  Object.entries(raw).forEach(([key, value]: [string, unknown]): void => {
    if (typeof value === "string") clean[key] = value
  })
  return clean
}

// iOS 的两种绝对路径前缀指向同一位置；只处理该别名，不按文件名猜目录。
function canonicalPath(path: string): string {
  return path.replace(/^\/private\/var(?=\/|$)/, "/var").replace(/\/+$/, "")
}

function ruleSourceKey(path: string): string | null {
  const bookmark: string = savedBookmark("rule")
  const dir: string | null = bookmark ? FileManager.bookmarkedPath(bookmark) : null
  if (!dir || canonicalPath(Path.dirname(path)) !== canonicalPath(dir)) return null
  return JSON.stringify([bookmark, Path.basename(path)])
}

export function sourceFor(path: string, kind?: ResourceKind): string {
  if (kind === "rule") {
    const key: string | null = ruleSourceKey(path)
    const rules: Record<string, string> = sourceMap(RULE_SOURCES_KEY)
    if (key !== null && rules[key] !== undefined) return rules[key]
  }
  const sources: Record<string, string> = sourceMap()
  const canonical: string = canonicalPath(path)
  return sources[path] ?? sources[canonical]
    ?? (canonical === "/var" || canonical.startsWith("/var/") ? sources[`/private${canonical}`] : undefined) ?? ""
}

function saveSource(path: string, url: string, kind?: ResourceKind, bookmark?: string): void {
  // 调用方在最后一次异步校验后传入书签快照，避免清理或写入其他目录的绑定。
  if (kind === "rule") {
    if (!bookmark) throw new Error("分流目录授权已变化，未保存来源")
    const rules: Record<string, string> = sourceMap(RULE_SOURCES_KEY)
    const key: string = JSON.stringify([bookmark, Path.basename(path)])
    if (url) rules[key] = url
    else delete rules[key]
    if (!Storage.set(RULE_SOURCES_KEY, rules)) throw new Error("分流来源记录保存失败")
  }
  const sources: Record<string, string> = sourceMap()
  // 同一文件的旧别名记录一并移除，防止删除后又读回过期来源。
  const canonical: string = canonicalPath(path)
  Object.keys(sources).forEach((key: string): void => {
    if (canonicalPath(key) === canonical) delete sources[key]
  })
  if (url) sources[path] = url
  if (!Storage.set(SOURCES_KEY, sources)) throw new Error("来源记录保存失败")
}

export async function listResources(dir: string, kind: ResourceKind): Promise<ResourceFile[]> {
  if (!(await FileManager.exists(dir))) return []
  const names: string[] = await FileManager.readDirectory(dir)
  const files: ResourceFile[] = []
  for (const name of names) {
    const path: string = name.startsWith("/") ? name : Path.join(dir, name)
    if (Path.dirname(path).replace(/\/+$/, "") !== dir.replace(/\/+$/, "")) continue
    if (!isResourceFile(path, kind) || await FileManager.isLink(path) || !(await FileManager.isFile(path))) continue
    files.push({ name: Path.basename(path), path, link: sourceFor(path, kind) })
  }
  return files.sort((a: ResourceFile, b: ResourceFile): number => a.name.localeCompare(b.name))
}

async function confirmWrite(path: string): Promise<boolean> {
  if (!(await FileManager.exists(path))) return true
  if (await FileManager.isLink(path) || !(await FileManager.isFile(path))) throw new Error("目标不是普通文件，拒绝覆盖")
  return Dialog.confirm({ title: "确认覆盖文件", message: `将替换以下文件的全部内容：\n${path}`, confirmLabel: "覆盖", cancelLabel: "取消" })
}

// Only the confirmed rule batch supplies this immutable, invocation-local scope.
// Omission always retains the normal per-file overwrite confirmation.
export type RuleBatchAuthorization = Readonly<{
  kind: "rule"
  destination: Destination
  directory: string
  bookmark: string
  files: readonly Readonly<ResourceFile>[]
}>

export async function downloadResource(
  kind: ResourceKind,
  destination: Destination,
  fileName: string,
  rawURL: string,
  onProgress?: (progress: DownloadProgress) => void,
  batch?: RuleBatchAuthorization,
  expectedFile?: Readonly<ResourceFile>
): Promise<string | null> {
  const name: string = validateFileName(fileName, kind)
  const url: string = validateURL(rawURL)
  const dir: string = await resolveDirectory(kind, destination)
  const bookmark: string = savedBookmark(kind)
  const path: string = Path.join(dir, name)
  const existed: boolean = await FileManager.exists(path)
  const expected = expectedFile ? { ...expectedFile } : undefined
  async function verifySingle(): Promise<void> {
    if (!expected) return
    if (canonicalPath(expected.path) !== canonicalPath(path) || expected.name !== name
      || validateURL(expected.link) !== url || validateURL(sourceFor(path, kind)) !== url
      || await FileManager.isLink(path) || !(await FileManager.isFile(path))) {
      throw new Error("文件目标或默认来源已变化，请刷新后重新更新")
    }
  }
  async function verifyBatch(): Promise<void> {
    if (!batch) return
    const member: Readonly<ResourceFile> | undefined = batch.files.find((file: Readonly<ResourceFile>): boolean => file.path === path && file.name === name && file.link === url)
    if (kind !== batch.kind || destination !== batch.destination || dir !== batch.directory || !member
      || (destination === "surge" && savedBookmark(kind) !== batch.bookmark)
      || validateURL(sourceFor(path, kind)) !== url) {
      throw new Error("批量更新范围、来源或目录授权已变化，请刷新后重试")
    }
    if (await FileManager.isLink(path) || !(await FileManager.isFile(path))) throw new Error("批量目标已变化或不是普通文件，拒绝覆盖")
  }
  await verifySingle()
  if (batch) await verifyBatch()
  else if (!(await confirmWrite(path))) return null
  // Also re-resolve after a potentially long confirmation, before any download.
  if (await resolveDirectory(kind, destination) !== dir || savedBookmark(kind) !== bookmark) throw new Error("目录已变化，请重新下载")
  await verifySingle()
  const temporary: string = Path.join(FileManager.temporaryDirectory, `surge-resource-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  try {
    await downloadWithProgress(url, temporary, onProgress)
    const bytes: Uint8Array = await FileManager.readAsBytes(temporary)
    if (!bytes.length) throw new Error("下载内容为空，未修改目标文件")
    // 下载期间权限或目标变化时停止，不使用失效路径。
    if (await resolveDirectory(kind, destination) !== dir || savedBookmark(kind) !== bookmark) throw new Error("目录已变化，请重新下载")
    await verifySingle()
    if (batch) await verifyBatch()
    else if (!existed && !(await confirmWrite(path))) return null
    if (await FileManager.isLink(path) || (await FileManager.exists(path) && !(await FileManager.isFile(path)))) throw new Error("目标不是普通文件，拒绝覆盖")
    // 下载完成后才写目标；分流内容保持原始字节，不注入模块元数据。
    await FileManager.writeAsBytes(path, bytes)
    invalidateUpdateState(path, kind)
    saveSource(path, url, kind, bookmark)
    return path
  } finally {
    if (await FileManager.exists(temporary)) {
      try { await FileManager.remove(temporary) } catch { /* 临时文件由系统回收 */ }
    }
  }
}

export type ResourceEdit = {
  kind: ResourceKind
  destination: Destination
  file: ResourceFile
  directory: string
  bookmark: string
  original: string
}

async function editPath(kind: ResourceKind, destination: Destination, file: ResourceFile): Promise<string> {
  const dir: string = await resolveDirectory(kind, destination)
  const name: string = validateFileName(file.name, kind)
  const path: string = Path.join(dir, name)
  if (canonicalPath(path) !== canonicalPath(file.path) || await FileManager.isLink(path) || !(await FileManager.isFile(path))) {
    throw new Error("文件或授权目录已变化，请刷新后重新编辑")
  }
  return dir
}

export async function bindResourceSource(kind: ResourceKind, destination: Destination, file: ResourceFile, rawURL: unknown): Promise<void> {
  const url: string = validateURL(rawURL)
  const snapshot: ResourceFile = { ...file }
  const directory: string = await editPath(kind, destination, snapshot)
  const bookmark: string = savedBookmark(kind)
  // UI 已完成输入授权；这里只校验，不弹窗、不下载、不写资源文件。
  const current: string = await resolveDirectory(kind, destination)
  if (canonicalPath(current) !== canonicalPath(directory) || savedBookmark(kind) !== bookmark) {
    throw new Error("目录授权已变化，请刷新后重新绑定来源")
  }
  if (sourceFor(snapshot.path, kind) !== snapshot.link) {
    throw new Error("文件来源已变化，请刷新后重新绑定")
  }
  saveSource(snapshot.path, url, kind, bookmark)
  invalidateUpdateState(snapshot.path, kind)
}

export async function beginResourceEdit(kind: ResourceKind, destination: Destination, file: ResourceFile): Promise<ResourceEdit> {
  const directory: string = await editPath(kind, destination, file)
  const bookmark: string = destination === "surge" ? savedBookmark(kind) : ""
  const original: string = await FileManager.readAsString(file.path)
  return { kind, destination, file, directory, bookmark, original }
}

export async function saveResourceEdit(edit: ResourceEdit, text: string): Promise<boolean> {
  if (text === edit.original) return false
  async function verify(): Promise<void> {
    const dir: string = await editPath(edit.kind, edit.destination, edit.file)
    if (dir !== edit.directory || (edit.destination === "surge" && savedBookmark(edit.kind) !== edit.bookmark)) {
      throw new Error("目录授权已变化，请重新编辑")
    }
    if (await FileManager.readAsString(edit.file.path) !== edit.original) {
      throw new Error("文件已被其他操作修改，未覆盖；请取消编辑并刷新")
    }
  }
  await verify()
  if (!(await Dialog.confirm({ title: "保存原文修改", message: `将覆盖 ${edit.file.name} 的文件内容${text.length === 0 ? "（保存为空文件）" : ""}。不添加模块标签，不修改下载来源。继续？`, confirmLabel: "保存并覆盖", cancelLabel: "取消" }))) return false
  // 确认框等待期间书签、文件类型和内容均可能变化，写入前再次校验。
  await verify()
  await FileManager.writeAsString(edit.file.path, text)
  invalidateUpdateState(edit.file.path, edit.kind)
  return true
}

export async function deleteResource(file: ResourceFile): Promise<boolean> {
  const snapshot: ResourceFile = { ...file }
  const isRule: boolean = isResourceFile(snapshot.name, "rule")
  const directory: string = isRule ? await editPath("rule", "surge", snapshot) : ""
  const bookmark: string = isRule ? savedBookmark("rule") : ""
  if (!(await Dialog.confirm({ title: "删除文件", message: `此操作无法撤销：\n${snapshot.path}`, confirmLabel: "删除", cancelLabel: "取消" }))) return false
  if (await FileManager.isLink(snapshot.path) || !(await FileManager.isFile(snapshot.path))) throw new Error("目标已变化，请刷新")
  if (isRule && (canonicalPath(await editPath("rule", "surge", snapshot)) !== canonicalPath(directory)
    || canonicalPath(await resolveDirectory("rule", "surge")) !== canonicalPath(directory)
    || savedBookmark("rule") !== bookmark)) throw new Error("分流目录授权已变化，请刷新后重新删除")
  await FileManager.remove(snapshot.path)
  invalidateUpdateState(snapshot.path, isRule ? "rule" : "module")
  saveSource(snapshot.path, "", isRule ? "rule" : "module", bookmark)
  return true
}
