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
  Menu,
  Image,
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
import { savedBookmark, storeBookmark } from "../utils/resources"
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
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({})
  const [ruleBookmark, setRuleBookmark] = useState<string>(() => savedBookmark("rule"))
  const [authorizing, setAuthorizing] = useState<boolean>(false)

  const concurrencyOptions = Array.from({ length: 10 }, (_, idx) => idx + 1)

  useEffect(() => {
    setCfg(props.initial ?? loadConfig())
    void refreshBookmarks()
    void refreshCounts(props.initial ?? loadConfig())
  }, [])

  async function refreshBookmarks(): Promise<void> {
    try {
      const folders: { name: string; path: string }[] = []
      for (const bookmark of FileManager.getAllFileBookmarks()) {
        // 书签也可能指向文件；离线书签保留展示，但使用前必须重新校验。
        if (bookmark.name && (!bookmark.path || await FileManager.isDirectory(bookmark.path))) folders.push(bookmark)
      }
      setBookmarks(folders)
    } catch {
      setBookmarks([])
    }
  }

  async function applyBookmark(kind: ResourceKind, name: string): Promise<void> {
    const path: string | null = FileManager.bookmarkedPath(name)
    if (!path) throw new Error("书签文件夹暂不可用，请检查文件提供商或重新授权")
    if (!(await FileManager.isDirectory(path))) throw new Error("所选书签不是文件夹")
    const otherName: string = kind === "module" ? ruleBookmark : cfg.baseBookmarkName
    const otherPath: string | null = otherName ? FileManager.bookmarkedPath(otherName) : null
    if (otherPath === path && !(await Dialog.confirm({ title: "两类使用同一目录", message: "通常模块和分流应选择不同文件夹，仍然使用？" }))) return
    if (kind === "module") {
      const next: AppConfig = { ...cfg, baseDir: path, baseBookmarkName: name }
      saveConfig(next)
      setCfg(next)
      props.onDone?.(next)
      await refreshCounts(next)
    } else {
      storeBookmark(kind, { path, bookmarkName: name })
      setRuleBookmark(name)
    }
  }

  async function selectBookmark(kind: ResourceKind, name: string): Promise<void> {
    if (!name || authorizing) return
    setAuthorizing(true)
    try {
      await applyBookmark(kind, name)
    } catch (error: unknown) {
      await Dialog.alert({ title: "选择失败", message: String(error instanceof Error ? error.message : error) })
    } finally {
      setAuthorizing(false)
    }
  }

  function bookmarkPicker(kind: ResourceKind): JSX.Element {
    const selected: string = kind === "module" ? cfg.baseBookmarkName : ruleBookmark
    return (
      <Menu disabled={authorizing || bookmarks.length === 0} label={
        <HStack>
          <Text foregroundStyle="label">{resourceLabel(kind)}书签文件夹</Text>
          <Spacer />
          {selected ? <Text lineLimit={1}>{selected}</Text> : null}
          <Image systemName="chevron.up.chevron.down" font="caption" />
        </HStack>
      }>
        {bookmarks.map((bookmark) => (
          <Button key={bookmark.name} title={bookmark.name} systemImage={bookmark.name === selected ? "checkmark" : undefined}
            action={(): void => { void selectBookmark(kind, bookmark.name) }} />
        ))}
      </Menu>
    )
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
          <Section header={<Text>文件夹</Text>}>
            {bookmarkPicker("module")}
            {bookmarkPicker("rule")}
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
