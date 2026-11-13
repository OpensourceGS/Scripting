import { Path } from "scripting"
import { loadConfig } from "./config"
import { resolveDirectory, sourceFor } from "./resources"

export type ModuleInfo = {
  name: string
  link: string
  surgeName?: string
  category?: string
  filePath?: string
  saveDir?: string
  isLocal?: boolean
  content?: string
}

const MODULES_DIR_NAME = "Modules"

function fmOrThrow(): any {
  const fm = (globalThis as any).FileManager
  if (!fm) throw new Error("FileManager 不可用")
  return fm
}

function isPromiseLike(v: any): v is Promise<any> {
  return !!v && typeof v === "object" && typeof v.then === "function"
}

async function callMaybeAsync(fn: any, thisArg: any, args: any[]) {
  try {
    const r = fn.apply(thisArg, args)
    return isPromiseLike(r) ? await r : r
  } catch {
    return undefined
  }
}

function normalizePath(path: string): string {
  return String(path ?? "").replace(/\/+$/, "")
}

export function getBaseDir(): string {
  const name: string = loadConfig().baseBookmarkName
  const path: string | null = name ? FileManager.bookmarkedPath(name) : null
  if (!path || !FileManager.isDirectorySync(path)) throw new Error("请先在设置中选择可用的模块书签文件夹")
  return path
}

export function getModulesDir(): string {
  return getBaseDir()
}

export async function getModulesDirResolved(baseDir?: string): Promise<string> {
  const configured: string = normalizePath(loadConfig().baseDir)
  const root: string = normalizePath(await resolveDirectory("module", "surge"))
  const target: string = normalizePath(String(baseDir ?? "").trim())
  if (!target || target === configured || target === root) return root
  if (!target.startsWith(`${root}/`) || target.split("/").some((part: string): boolean => part === "." || part === "..")) {
    throw new Error("目标目录不在当前模块书签文件夹内，请刷新后重试")
  }
  if (!(await FileManager.isDirectory(target))) throw new Error("目标文件夹不可用")
  return target
}

async function exists(path: string): Promise<boolean> {
  const fm = fmOrThrow()
  if (typeof fm.exists === "function") return !!(await fm.exists(path))
  if (typeof fm.existsSync === "function") return !!fm.existsSync(path)
  return false
}

async function ensureDir(dir: string): Promise<void> {
  const fm = fmOrThrow()
  if (await exists(dir)) return
  if (typeof fm.createDirectory === "function") {
    await fm.createDirectory(dir, true)
    return
  }
  if (typeof fm.createDirectorySync === "function") {
    fm.createDirectorySync(dir, true)
    return
  }
  throw new Error("FileManager.createDirectory 不可用")
}

export async function ensureStorage(): Promise<void> {
  // 授权根目录必须已经存在，不能创建默认本地目录替代它。
  await getModulesDirResolved()
}

function extractNameFromPath(p: string): string {
  const base = String(p).split("/").pop() ?? String(p)
  return base.replace(/\.sgmodule$/i, "")
}

function parseTag(content: string, key: string): string | undefined {
  const re = new RegExp(`^\\s*#!\\s*${key}\\s*=\\s*(.*)$`, "im")
  const m = content.match(re)
  return m?.[1]?.trim()
}

function getLinkPrefixes(): string[] {
  const cfg = loadConfig()
  const raw = String(cfg.linkPatternsText ?? "").split(/\r?\n/g)
  return raw.filter((s) => s.trim().length > 0)
}

function parseLinkFromContent(content: string, prefixes: string[]): string {
  const lines = String(content ?? "").split(/\r?\n/g)
  for (const lineRaw of lines) {
    const line = lineRaw.trimStart()
    for (const prefix of prefixes) {
      if (line.startsWith(prefix)) {
        return line.slice(prefix.length).trim()
      }
    }
  }
  return ""
}

export function detectLinkPrefixFromContent(content: string, prefixes: string[]): string | undefined {
  const lines = String(content ?? "").split(/\r?\n/g)
  for (const lineRaw of lines) {
    const line = lineRaw.trimStart()
    const hit = prefixes.find((p) => line.startsWith(p))
    if (hit) return hit
  }
  return undefined
}

async function isDirectory(path: string): Promise<boolean> {
  const fm = fmOrThrow()
  if (typeof fm.isDirectory === "function") return !!(await fm.isDirectory(path))
  if (typeof fm.isDir === "function") return !!(await fm.isDir(path))
  return false
}

async function listModuleFilesRecursive(dir: string): Promise<string[]> {
  const fm = fmOrThrow()
  const list = await fm.readDirectory(dir)
  if (!Array.isArray(list)) return []
  const files: string[] = []
  for (const entry of list) {
    const raw = String(entry)
    const full = raw.includes("/") ? raw : Path.join(dir, raw)
    if (await isDirectory(full)) {
      const sub = await listModuleFilesRecursive(full)
      files.push(...sub)
      continue
    }
    if (!full.toLowerCase().endsWith(".sgmodule")) continue
    files.push(full)
  }
  return files
}

export async function loadModules(): Promise<ModuleInfo[]> {
  await ensureStorage()
  const fm = fmOrThrow()
  const dir = await getModulesDirResolved()

  const modules: ModuleInfo[] = []
  const files = await listModuleFilesRecursive(dir)
  for (const path of files) {
    const name = extractNameFromPath(path)
    if (!name) continue
    let text = ""
    try {
      text = await fm.readAsString(path)
    } catch {
      text = ""
    }
    const link: string = parseLinkFromContent(text, getLinkPrefixes()) || sourceFor(path)
    const localTag = parseTag(text, "local")
    const isLocal =
      localTag != null &&
      String(localTag).trim() !== "" &&
      !["0", "false", "no"].includes(String(localTag).trim().toLowerCase())
    // Include untagged module files too; the home list must not hide existing files.
    const category = parseTag(text, "category") ?? parseTag(text, "cagegory") ?? undefined
    const surgeName = parseTag(text, "name") ?? undefined
    modules.push({ name, link, surgeName, category, filePath: path, isLocal: isLocal || !link })
  }
  return modules
}

export function moduleFilePath(moduleName: string, dir?: string): string {
  const base = dir ?? getModulesDir()
  return Path.join(base, `${moduleName}.sgmodule`)
}

function resolveModulePath(target: ModuleInfo | string): string {
  if (typeof target === "string") return moduleFilePath(target)
  return target.filePath ?? moduleFilePath(target.name)
}

export async function moveModuleFile(
  target: ModuleInfo | string,
  nextDir?: string,
  nextName?: string
): Promise<string> {
  const fm = fmOrThrow()
  const from = resolveModulePath(target)
  const name = String(nextName ?? (typeof target === "string" ? target : target.name)).trim()
  const baseDir = nextDir ?? Path.dirname(from)
  const to = moduleFilePath(name, baseDir)

  if (normalizePath(from) === normalizePath(to)) return to
  await ensureDir(baseDir)
  if (await exists(to)) throw new Error("目标文件已存在，请换一个名称或目录，未移动原文件")
  if (!(await exists(from))) return to

  if (typeof fm.rename === "function") {
    await fm.rename(from, to)
    return to
  }
  if (typeof fm.renameSync === "function") {
    fm.renameSync(from, to)
    return to
  }
  throw new Error("FileManager.rename 不可用")
}

export async function detectLinkPrefix(target: ModuleInfo | string): Promise<string | undefined> {
  const fm = fmOrThrow()
  const path = resolveModulePath(target)
  if (!(await exists(path))) return undefined
  const raw = await fm.readAsString(path)
  return detectLinkPrefixFromContent(String(raw ?? ""), getLinkPrefixes())
}

export async function removeModuleFile(target: ModuleInfo | string): Promise<void> {
  const fm = fmOrThrow()
  const path = resolveModulePath(target)
  if (!(await exists(path))) return
  if (typeof fm.remove === "function") {
    await fm.remove(path)
    return
  }
  if (typeof fm.removeSync === "function") {
    fm.removeSync(path)
    return
  }
  throw new Error("FileManager.remove 不可用")
}

export async function renameModuleFile(oldTarget: ModuleInfo | string, newName: string): Promise<void> {
  const fm = fmOrThrow()
  const from = resolveModulePath(oldTarget)
  const to = Path.join(Path.dirname(from), `${newName}.sgmodule`)
  if (!(await exists(from))) return
  if (typeof fm.rename === "function") {
    await fm.rename(from, to)
    return
  }
  if (typeof fm.renameSync === "function") {
    fm.renameSync(from, to)
    return
  }
  throw new Error("FileManager.rename 不可用")
}

function upsertTag(content: string, key: string, value?: string): string {
  const trimmed = String(value ?? "").trim()
  if (!trimmed) {
    return content.replace(new RegExp(`^\\s*#!\\s*${key}\\s*=.*\\n?`, "im"), "")
  }
  const line = `#!${key}=${trimmed}`
  const re = new RegExp(`^\\s*#!\\s*${key}\\s*=.*$`, "im")
  if (re.test(content)) return content.replace(re, line)
  return `${line}\n${content}`
}

function upsertLink(content: string, prefixes: string[], value?: string): string {
  const trimmed = String(value ?? "").trim()
  if (!trimmed) return content
  const lines = String(content ?? "").split(/\r?\n/g)
  let matchedPrefix: string | undefined
  const filtered = lines.filter((line) => {
    const t = line.trimStart()
    const hit = prefixes.find((p) => t.startsWith(p))
    if (hit && !matchedPrefix) matchedPrefix = hit
    return !hit
  })
  const prefix = matchedPrefix ?? prefixes[0] ?? "#url="
  return `${prefix}${trimmed}\n${filtered.join("\n")}`
}

export async function updateModuleMetadata(
  target: ModuleInfo | string,
  info: { link?: string; category?: string; local?: boolean }
) {
  const fm = fmOrThrow()
  const path = resolveModulePath(target)
  if (!(await exists(path))) return
  const raw = await fm.readAsString(path)
  let content = String(raw ?? "")
  content = upsertLink(content, getLinkPrefixes(), info.link)
  content = upsertTag(content, "category", info.category)
  if (info.local !== undefined) {
    content = upsertTag(content, "local", info.local ? "true" : "")
  }
  await fm.writeAsString(path, content)
}

export async function saveLocalModule(info: ModuleInfo, rawContent: string): Promise<void> {
  await ensureStorage()
  const fm = fmOrThrow()
  if (!fm?.writeAsString) throw new Error("FileManager.writeAsString 不可用")
  const targetDir = await getModulesDirResolved(info.saveDir)
  await ensureDir(targetDir)
  const path = moduleFilePath(info.name, targetDir)
  if (await exists(path)) {
    const confirmed: boolean = await Dialog.confirm({ title: "确认保存并覆盖模块", message: path, confirmLabel: "覆盖", cancelLabel: "取消" })
    if (!confirmed) throw new Error("已取消覆盖")
  }
  let content = String(rawContent ?? "")
  content = upsertTag(content, "local", "true")
  content = upsertTag(content, "category", info.category)
  await fm.writeAsString(path, content)
}

export async function listDirectSubDirs(baseDir?: string): Promise<string[]> {
  const fm = fmOrThrow()
  const root = await getModulesDirResolved(baseDir)
  const list = await fm.readDirectory(root)
  if (!Array.isArray(list)) return []
  const dirs: string[] = []
  for (const entry of list) {
    const raw = String(entry)
    const full = raw.includes("/") ? raw : Path.join(root, raw)
    const name = raw.includes("/") ? raw.split("/").pop() ?? raw : raw
    if (!name || name.startsWith(".")) continue
    if (name === "__pycache__" || name === "__pypackages__") continue
    if (await isDirectory(full)) dirs.push(full)
  }
  return dirs
}

export async function loadCategoriesFromModules(baseDir?: string): Promise<{
  categories: string[]
  scanned: number
  added: number
}> {
  const fm = fmOrThrow()
  const primaryDir = await getModulesDirResolved(baseDir)
  const altDir = baseDir ? Path.join(primaryDir, MODULES_DIR_NAME) : undefined
  let files: string[] = []
  if (await exists(primaryDir)) {
    files = await listModuleFilesRecursive(primaryDir)
  }
  if (!files.length && altDir && (await exists(altDir))) {
    files = await listModuleFilesRecursive(altDir)
  }
  const set = new Set<string>()
  for (const path of files) {
    let text = ""
    try {
      text = await fm.readAsString(path)
    } catch {
      text = ""
    }
    const cat = parseTag(text, "category") ?? parseTag(text, "cagegory")
    if (cat) set.add(cat)
  }
  const categories = Array.from(set)
  return { categories, scanned: files.length, added: categories.length }
}

export async function renameCategoryInModules(oldName: string, newName: string, baseDir?: string): Promise<void> {
  const fm = fmOrThrow()
  const primaryDir = await getModulesDirResolved(baseDir)
  const altDir = baseDir ? Path.join(primaryDir, MODULES_DIR_NAME) : undefined
  let files: string[] = []
  if (await exists(primaryDir)) {
    files = await listModuleFilesRecursive(primaryDir)
  }
  if (!files.length && altDir && (await exists(altDir))) {
    files = await listModuleFilesRecursive(altDir)
  }
  for (const path of files) {
    let text = ""
    try {
      text = await fm.readAsString(path)
    } catch {
      continue
    }
    const cat = parseTag(text, "category")
    if (!cat || cat !== oldName) continue
    let content = upsertTag(text, "category", newName)
    await fm.writeAsString(path, content)
  }
}

export async function countModulesByCategory(baseDir?: string): Promise<Record<string, number>> {
  const fm = fmOrThrow()
  const primaryDir = await getModulesDirResolved(baseDir)
  const altDir = baseDir ? Path.join(primaryDir, MODULES_DIR_NAME) : undefined
  let files: string[] = []
  if (await exists(primaryDir)) {
    files = await listModuleFilesRecursive(primaryDir)
  }
  if (!files.length && altDir && (await exists(altDir))) {
    files = await listModuleFilesRecursive(altDir)
  }
  const counts: Record<string, number> = {}
  for (const path of files) {
    let text = ""
    try {
      text = await fm.readAsString(path)
    } catch {
      text = ""
    }
    const cat = parseTag(text, "category") ?? parseTag(text, "cagegory") ?? ""
    if (!cat) continue
    counts[cat] = (counts[cat] ?? 0) + 1
  }
  return counts
}

export function sortModules(list: ModuleInfo[]): ModuleInfo[] {
  return [...list].sort((a, b) => {
    const ca = String(a.category ?? "")
    const cb = String(b.category ?? "")
    if (ca !== cb) return ca.localeCompare(cb)
    return a.name.localeCompare(b.name)
  })
}
