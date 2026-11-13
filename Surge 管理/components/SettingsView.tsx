import {
  Button,
  ForEach,
  Form,
  Navigation,
  NavigationStack,
  Section,
  SecureField,
  Text,
  TextField,
  VStack,
  HStack,
  Spacer,
  Picker,
  useEffect,
  useState,
} from "scripting"

import {
  addCategory,
  loadConfig,
  saveConfig,
  type AppConfig,
} from "../utils/config"
import { countModulesByCategory, loadCategoriesFromModules, renameCategoryInModules } from "../utils/storage"
import { savedBookmark, storeBookmark, type DirectoryBookmark } from "../utils/resources"
import { type ResourceKind, resourceLabel } from "../utils/resource_policy"

function PlainRowButton(props: { title: string; onPress: () => void }) {
  return (
    <Button
      action={() => {
        HapticFeedback.mediumImpact()
        props.onPress()
      }}
    >
      <HStack frame={{ width: "100%" as any }} padding={{ top: 14, bottom: 14 }}>
        <Text opacity={0} frame={{ width: 1 }}>
          .
        </Text>
        <Spacer />
        <Text font="headline">{props.title}</Text>
        <Spacer />
      </HStack>
    </Button>
  )
}

export function SettingsView(props: {
  initial?: AppConfig
  onDone?: (cfg: AppConfig) => void
}) {
  const dismiss = Navigation.useDismiss()
  const initialCfg = props.initial ?? loadConfig()
  const [cfg, setCfg] = useState<AppConfig>(initialCfg)

  const [bookmarks, setBookmarks] = useState<{ name: string; path: string }[]>([])
  const [bookmarkIdx, setBookmarkIdx] = useState<number>(0)
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({})
  const [ruleBookmark, setRuleBookmark] = useState<string>(() => savedBookmark("rule"))
  const [authorizing, setAuthorizing] = useState<boolean>(false)

  async function authorize(kind: ResourceKind): Promise<void> {
    if (authorizing) return
    setAuthorizing(true)
    try {
      const bookmark: DirectoryBookmark | null = await DocumentPicker.pickDirectoryBookmark({ preferredName: `Surge整体管理-${resourceLabel(kind)}-${Date.now()}` })
      if (!bookmark) return
      const otherName: string = kind === "module" ? ruleBookmark : cfg.baseBookmarkName
      const otherPath: string | null = otherName ? FileManager.bookmarkedPath(otherName) : null
      if (otherPath === bookmark.path && !(await Dialog.confirm({ title: "两类使用同一目录", message: "通常模块和分流应选择不同文件夹，仍然使用？" }))) return
      storeBookmark(kind, bookmark)
      if (kind === "module") {
        const next: AppConfig = { ...cfg, baseDir: bookmark.path, baseBookmarkName: bookmark.bookmarkName }
        setCfg(next)
        await refreshBookmarks(next)
        await refreshCounts(next)
      } else {
        setRuleBookmark(bookmark.bookmarkName)
      }
    } catch (error: unknown) {
      await Dialog.alert({ title: "授权失败", message: String(error instanceof Error ? error.message : error) })
    } finally {
      setAuthorizing(false)
    }
  }
  const concurrencyOptions = Array.from({ length: 10 }, (_, idx) => idx + 1)

  useEffect(() => {
    setCfg(props.initial ?? loadConfig())
    void refreshBookmarks(props.initial ?? loadConfig())
    void refreshCounts(props.initial ?? loadConfig())
  }, [])

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

  async function refreshBookmarks(current?: AppConfig): Promise<{ name: string; path: string }[]> {
    const fm: any = (globalThis as any).FileManager
    let list: any = []
    if (fm?.getAllFileBookmarks) {
      try {
        const r = fm.getAllFileBookmarks()
        list = r && typeof r.then === "function" ? await r : r
      } catch {
        list = []
      }
    }
    const arr = Array.isArray(list) ? list : []
    const cleaned = arr
      .map((x: any) => ({ name: String(x?.name ?? ""), path: String(x?.path ?? "") }))
      .filter((x: any) => x.name && x.path)
    setBookmarks(cleaned)

    const targetName = current?.baseBookmarkName ?? cfg.baseBookmarkName
    const targetPath = current?.baseDir ?? cfg.baseDir
    if (cleaned.length) {
      let idx = -1
      if (targetName) idx = cleaned.findIndex((b) => b.name === targetName)
      if (idx < 0 && targetPath) idx = cleaned.findIndex((b) => b.path === targetPath)
      setBookmarkIdx(idx >= 0 ? idx : 0)
      if (idx >= 0) {
        const matched = cleaned[idx]
        const canUseByName = fm?.bookmarkExists
          ? !!(await callMaybeAsync(fm.bookmarkExists, fm, [matched.name]))
          : true
        const resolved = fm?.bookmarkedPath && canUseByName
          ? String((await callMaybeAsync(fm.bookmarkedPath, fm, [matched.name])) ?? matched.path)
          : matched.path
        const pathChanged = resolved !== targetPath || matched.name !== targetName
        if (pathChanged) {
          setCfg((c) => ({ ...c, baseDir: resolved, baseBookmarkName: matched.name }))
          try {
            const next = { ...loadConfig(), baseDir: resolved, baseBookmarkName: matched.name }
            saveConfig(next)
            props.onDone?.(next)
          } catch {}
        }
      }
    } else {
      setBookmarkIdx(0)
    }
    return cleaned
  }

  async function refreshCounts(current?: AppConfig) {
    try {
      const counts = await countModulesByCategory(current?.baseDir ?? cfg.baseDir)
      setCategoryCounts(counts)
    } catch {
      setCategoryCounts({})
    }
  }

  async function addCategoryAction() {
    const name = (await Dialog.prompt({
      title: "添加分类",
      message: "请输入分类名称",
      placeholder: "分类名称",
    }))?.trim()
    if (!name) return
    if (cfg.categories.includes(name)) {
      await Dialog.alert({ message: "分类已存在" })
      return
    }
    setCfg((c) => addCategory(c, name))
    await refreshCounts()
  }

  async function importCategories() {
    if (!cfg.baseDir) {
      await Dialog.alert({ message: "请先选择书签文件夹" })
      return
    }
    const result = await loadCategoriesFromModules(cfg.baseDir)
    const list = result.categories
    const existing = new Set(cfg.categories ?? [])
    const toAdd = list.filter((c) => !existing.has(c))
    if (!list.length) {
      await Dialog.alert({
        message: `未找到任何分类（扫描 ${result.scanned} 个模块文件）\n仅识别 #!category=xxx 或 #!cagegory=xxx`,
      })
      return
    }
    if (!toAdd.length) {
      await Dialog.alert({
        message: `导入完成：扫描 ${result.scanned} 个模块文件，新增 0 个分类`,
      })
      return
    }
    setCfg((c) => ({ ...c, categories: [...(c.categories ?? []), ...toAdd] }))
    await Dialog.alert({
      message: `导入完成：扫描 ${result.scanned} 个模块文件，新增 ${toAdd.length} 个分类`,
    })
    await refreshCounts()
  }

  async function editCategory(oldName: string) {
    const nextName = (await Dialog.prompt({
      title: "编辑分类",
      message: "请输入新的分类名称",
      defaultValue: oldName,
      placeholder: "分类名称",
    }))?.trim()
    if (!nextName || nextName === oldName) return
    if (cfg.categories.includes(nextName)) {
      await Dialog.alert({ message: "分类已存在" })
      return
    }
    if (!(await Dialog.confirm({ title: "更新分类与模块元数据", message: `将 ${oldName} 改为 ${nextName}，并更新对应模块文件中的分类标签。继续？` }))) return
    setCfg((c) => {
      const list = (c.categories ?? []).map((n) => (n === oldName ? nextName : n))
      return { ...c, categories: list }
    })
    await renameCategoryInModules(oldName, nextName, cfg.baseDir)
    await refreshCounts()
  }

async function deleteCategoryAt(indices: number[]): Promise<void> {
    if (!indices.length) return
    if (!(await Dialog.confirm({ title: "删除分类", message: "仅删除分类列表项，不删除模块文件。继续？" }))) return
    HapticFeedback.heavyImpact()
    setCfg((c) => {
      const next = [...(c.categories ?? [])]
      const sorted = [...indices].sort((a, b) => b - a)
      for (const i of sorted) {
        if (i >= 0 && i < next.length) next.splice(i, 1)
      }
      return { ...c, categories: next }
    })
    void refreshCounts()
  }

  async function saveAndClose() {
    try {
      saveConfig(cfg)
      props.onDone?.(cfg)
      dismiss()
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    }
  }

  return (
    <NavigationStack>
      <VStack
        navigationTitle={"设置"}
        navigationBarTitleDisplayMode={"inline"}
        toolbar={{
          topBarTrailing: (
            <Button
              title="保存"
              disabled={authorizing}
              action={() => {
                HapticFeedback.mediumImpact()
                void saveAndClose()
              }}
            />
          ),
        }}
      >
        <Form formStyle="grouped">
          <Section header={<Text>模块目录 · 独立授权</Text>}>
            <Button title="选择 / 重新授权模块文件夹" disabled={authorizing} action={(): void => { void authorize("module") }} />
            <TextField
              label={<Text>路径</Text>}
              value={cfg.baseDir}
              onChanged={(v: string) => setCfg((c) => ({ ...c, baseDir: v, baseBookmarkName: "" }))}
              prompt="粘贴或选择目录"
              textFieldStyle="roundedBorder"
            />
            <Text font="caption" foregroundStyle="secondaryLabel">
              授权立即生效；已有书签和旧路径保留兼容。只粘贴路径不代表取得授权。
            </Text>
            {bookmarks.length ? (
              <Picker
                title={"书签文件夹"}
                pickerStyle="menu"
                value={bookmarkIdx}
                onChanged={(idx: number) => {
                  HapticFeedback.heavyImpact()
                  setBookmarkIdx(idx)
                  const b = bookmarks[idx]
                  if (b?.path) {
                    void (async () => {
                      const fm: any = (globalThis as any).FileManager
                      const canUseByName = fm?.bookmarkExists
                        ? !!(await callMaybeAsync(fm.bookmarkExists, fm, [b.name]))
                        : true
                      const resolved = fm?.bookmarkedPath && canUseByName
                        ? String((await callMaybeAsync(fm.bookmarkedPath, fm, [b.name])) ?? b.path)
                        : b.path
                      const next: AppConfig = { ...cfg, baseDir: resolved, baseBookmarkName: b.name }
                      setCfg(next)
                      try {
                        saveConfig(next)
                        props.onDone?.(next)
                      } catch {}
                    })()
                  }
                }}
              >
                {bookmarks.map((b, index) => (
                  <Text key={b.name} tag={index}>
                    {b.name}
                  </Text>
                ))}
              </Picker>
            ) : null}
          </Section>

          <Section header={<Text>分流目录 · 独立授权</Text>}>
            <Text font="caption" foregroundStyle="secondaryLabel">{ruleBookmark || "未授权 · 本地下载仍可使用"}</Text>
            <Button title="选择 / 重新授权分流文件夹" disabled={authorizing} action={(): void => { void authorize("rule") }} />
            <Text font="caption" foregroundStyle="secondaryLabel">分流文件原样保存，不修改 RULE-SET 引用。本地模块和分流不依赖上述授权。</Text>
          </Section>
          <Section header={<Text>HTTP 远程控制 · 模块开关</Text>}>
            <TextField title="地址" value={cfg.remoteHost} prompt="http://127.0.0.1" keyboardType="URL" onChanged={(value: string): void => setCfg((current: AppConfig): AppConfig => ({ ...current, remoteHost: value }))} />
            <TextField title="端口" value={cfg.remotePort} prompt="6171" keyboardType="numberPad" onChanged={(value: string): void => setCfg((current: AppConfig): AppConfig => ({ ...current, remotePort: value }))} />
            <SecureField title="密码" value={cfg.remotePassword} prompt="X-Key" onChanged={(value: string): void => setCfg((current: AppConfig): AppConfig => ({ ...current, remotePassword: value }))} />
          </Section>
          <Section header={<Text>链接格式</Text>}>
            <TextField
              label={<Text>前缀</Text>}
              value={cfg.linkPatternsText}
              onChanged={(v: string) => setCfg((c) => ({ ...c, linkPatternsText: v }))}
              axis="vertical"
              lineLimit={{ min: 3, max: 6 }}
              prompt={"例如：\n#!url=\n#SUBSCRIBED \n每行一个，按顺序优先匹配"}
              textFieldStyle="roundedBorder"
            />
          </Section>

          <Section header={<Text>下载设置</Text>}>
            <Picker
              title={"并发下载数"}
              pickerStyle="menu"
              value={Math.max(0, concurrencyOptions.indexOf(cfg.downloadConcurrency))}
              onChanged={(idx: number) => {
                HapticFeedback.heavyImpact()
                const next = concurrencyOptions[idx] ?? 3
                setCfg((c) => ({ ...c, downloadConcurrency: next }))
              }}
            >
              {concurrencyOptions.map((num, idx) => (
                <Text key={`${num}`} tag={idx}>
                  {num}
                </Text>
              ))}
            </Picker>
          </Section>

          <Section header={<Text>分类列表</Text>}>
            {cfg.categories.length === 0 ? (
              <Text>暂无分类</Text>
            ) : (
              <ForEach
                count={cfg.categories.length}
                onDelete={(indices) => deleteCategoryAt(indices)}
                  itemBuilder={(index) => {
                    const cat = cfg.categories[index]
                    const count = categoryCounts[cat] ?? 0
                    return (
                      <HStack
                        key={cat}
                        leadingSwipeActions={{
                          allowsFullSwipe: false,
                          actions: [
                            <Button
                              title="编辑"
                              action={() => {
                                HapticFeedback.mediumImpact()
                                editCategory(cat)
                              }}
                            />,
                          ],
                        }}
                      >
                        <Text>{cat}</Text>
                        <Spacer />
                        <Text>{count}</Text>
                      </HStack>
                    )
                  }}
              />
            )}
          </Section>

          <Section>
            <PlainRowButton title="导入分类" onPress={importCategories} />
            <PlainRowButton title="添加分类" onPress={addCategoryAction} />
          </Section>
        </Form>
      </VStack>
    </NavigationStack>
  )
}
