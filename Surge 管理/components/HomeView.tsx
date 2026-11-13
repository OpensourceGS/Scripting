import {
  Button,
  Group,
  HStack,
  List,
  Navigation,
  Picker,
  ProgressView,
  Section,
  Spacer,
  Text,
  TextField,
  Toggle,
  VStack,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "scripting"

import {
  loadModules,
  moduleFilePath,
  detectLinkPrefix,
  removeModuleFile,
  sortModules,
  type ModuleInfo,
  updateModuleMetadata,
  listDirectSubDirs,
  saveLocalModule,
  moveModuleFile,
} from "../utils/storage"
import { loadConfig, type AppConfig } from "../utils/config"
import { downloadModule } from "../utils/downloader"
import { EditModuleView } from "./EditModuleView"
import { ActionTileButton } from "./ActionTileButton"
import { resolveDirectory } from "../utils/resources"
import {
  fetchEnabledModuleNames,
  getModuleRemoteName,
  setRemoteModuleEnabled,
} from "../utils/remote_control"

export function HomeView(props: { onBusyChanged?: (busy: boolean) => void }) {
  const scanPending: { current: boolean } = useRef<boolean>(true)
  const [scanning, setScanning] = useState<boolean>(true)
  const scanGeneration: { current: number } = useRef<number>(0)
  const remoteGeneration: { current: number } = useRef<number>(0)
  const actionLock: { current: boolean } = useRef<boolean>(false)
  const withButtonHaptic: (action: () => void | Promise<void>, haptic?: boolean) => () => Promise<void> = (action: () => void | Promise<void>, haptic: boolean = true) => async (): Promise<void> => {
    if (scanPending.current || actionLock.current || busy || togglingModuleNames.size > 0) return
    actionLock.current = true
    setBusy(true)
    if (haptic) HapticFeedback.mediumImpact()
    try {
      await action()
    } catch (error: unknown) {
      await Dialog.alert({ message: error instanceof Error ? error.message : String(error) })
    } finally {
      actionLock.current = false
      setBusy(false)
    }
  }
  // Settings changes remount this scoped host via revision, never reuse old credentials.
  const cfg: AppConfig = useMemo<AppConfig>(loadConfig, [])
  const [query, setQuery] = useState<string>("")
  const [modules, setModules] = useState<ModuleInfo[]>([])
  const [stage, setStage] = useState("就绪")
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [resolvedBaseDir, setResolvedBaseDir] = useState("")
  const [filterCategory, setFilterCategory] = useState("全部")
  const [enabledModuleNames, setEnabledModuleNames] = useState<Set<string>>(new Set())
  const [togglingModuleNames, setTogglingModuleNames] = useState<Set<string>>(new Set())
  const [remoteStatus, setRemoteStatus] = useState<string>("远程状态读取中")
  useEffect((): void => { props.onBusyChanged?.(busy || togglingModuleNames.size > 0) }, [busy, togglingModuleNames])
  const categories = cfg.categories ?? []
  const filterOptions = ["全部", ...categories]
  const filterIdx = Math.max(0, filterOptions.indexOf(filterCategory))
  const baseDir = resolvedBaseDir || cfg.baseDir
  const dirOptions = useMemo(() => {
    const set = new Set<string>()
    for (const m of modules) {
      const p = m.filePath ? String(m.filePath) : ""
      if (!p) continue
      const rel = baseDir ? p.replace(baseDir, "").replace(/^\/+/, "") : p
      const dir = rel.includes("/") ? rel.split("/")[0] : ""
      if (dir) set.add(dir)
    }
    return ["全部", ...Array.from(set)]
  }, [modules, baseDir])
  const [filterDir, setFilterDir] = useState("全部")

  function getTopDir(m: ModuleInfo): string {
    const p = m.filePath ? String(m.filePath) : ""
    if (!p) return ""
    const rel = baseDir ? p.replace(baseDir, "").replace(/^\/+/, "") : p
    return rel.includes("/") ? rel.split("/")[0] : ""
  }

  function matchFilters(m: ModuleInfo): boolean {
    const catOk = filterCategory === "全部" ? true : m.category === filterCategory
    const dirOk = filterDir === "全部" ? true : getTopDir(m) === filterDir
    return catOk && dirOk && `${m.name} ${m.category ?? ""}`.toLowerCase().includes(query.toLowerCase())
  }

  const filteredModules = modules.filter((m) => {
    return matchFilters(m)
  })
  const onlyLocalFiltered =
    filteredModules.length > 0 && filteredModules.every((m: ModuleInfo): boolean => !m.link?.trim())
  const remoteControlReady = !!String(cfg.remotePort ?? "").trim()

  function inferSaveDir(m: ModuleInfo): string | undefined {
    if (!m.filePath) return undefined
    const idx = String(m.filePath).lastIndexOf("/")
    return idx > 0 ? String(m.filePath).slice(0, idx) : undefined
  }

  async function refreshModules(resetStageOnSuccess: boolean = false): Promise<void> {
    const token: number = ++scanGeneration.current
    scanPending.current = true
    setScanning(true)
    try {
      const resolved: string = await resolveDirectory("module", "surge")
      if (token !== scanGeneration.current) return
      const list: ModuleInfo[] = sortModules(await loadModules())
      if (token !== scanGeneration.current) return
      setResolvedBaseDir(resolved)
      setModules(list)
      if (resetStageOnSuccess) {
        setStage("就绪")
        setProgress(null)
      }
    } catch (e: any) {
      if (token !== scanGeneration.current) return
      setResolvedBaseDir("")
      setModules([])
      setStage(String(e?.message ?? e))
    } finally {
      if (token === scanGeneration.current) {
        scanPending.current = false
        setScanning(false)
      }
    }
  }

  useEffect((): (() => void) => {
    void refreshModules()
    return (): void => { scanGeneration.current += 1 }
  }, [])

  useEffect((): (() => void) => {
    void refreshRemoteModules(true)
    return (): void => { remoteGeneration.current += 1 }
  }, [cfg.remotePort, cfg.remotePassword])

  useEffect(() => {
    if (filterDir !== "全部" && !dirOptions.includes(filterDir)) {
      setFilterDir("全部")
    }
  }, [dirOptions, filterDir])

  useEffect(() => {
    if (filterCategory === "全部") return
    if (!categories.includes(filterCategory)) {
      setFilterCategory("全部")
    }
  }, [categories, filterCategory])

  async function refreshRemoteModules(silent: boolean = false, nextCfg: AppConfig = cfg): Promise<void> {
    const token: number = ++remoteGeneration.current
    if (!String(nextCfg.remotePort ?? "").trim()) {
      setEnabledModuleNames(new Set())
      setRemoteStatus("远程未配置")
      return
    }
    try {
      const enabled: Set<string> = await fetchEnabledModuleNames(nextCfg)
      if (token !== remoteGeneration.current) return
      setEnabledModuleNames(enabled)
      setRemoteStatus("远程已连接")
    } catch (e: any) {
      if (token !== remoteGeneration.current) return
      setRemoteStatus("远程不可用 · 开关状态未知")
      setEnabledModuleNames(new Set())
      if (!silent) setStage(`远程状态获取失败：${String(e?.message ?? e)}`)
    }
  }

  async function addModule() {
    if (!categories.length) {
      await Dialog.alert({ message: "请先在设置页添加分类" })
      return
    }
    const subDirs = await listDirectSubDirs()
    const info = await Navigation.present<ModuleInfo>({
      element: <EditModuleView title="添加模块" categories={categories} saveDirs={subDirs} />,
    })
    if (!info) return

    const current = await loadModules()
    const nameExists = current.some((m) => m.name === info.name)
    const linkExists = info.link ? current.some((m) => m.link === info.link) : false
    if (nameExists) {
      await Dialog.alert({ message: "模块名称已存在" })
      return
    }
    if (linkExists) {
      await Dialog.alert({ message: "下载链接已存在" })
      return
    }

    setBusy(true)
    setStage("添加模块中…")
    setProgress(null)
    try {
      if (info.isLocal) {
        setStage(`保存模块：${info.name}`)
        await saveLocalModule(info, info.content ?? "")
        setStage("添加完成（已保存）")
      } else {
        setStage(`下载模块：${info.name}`)
        const res = await downloadModule(info)
        if (!res.ok) {
          await Dialog.alert({ message: res.message ?? "下载失败" })
          setStage("添加完成（下载失败）")
        } else {
          setStage("添加完成（已下载）")
        }
      }
      await refreshModules()
    } catch (e: any) {
      setStage(`添加失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function modifyModuleFor(target: ModuleInfo) {
    const current = await loadModules()
    const subDirs = await listDirectSubDirs()
    const content: string = target.filePath ? await FileManager.readAsString(target.filePath) : ""
    const originalSaveDir = inferSaveDir(target)
    const updated = await Navigation.present<ModuleInfo>({
      element: (
        <EditModuleView
          title="编辑模块"
          categories={categories}
          initial={{ ...target, content, saveDir: originalSaveDir }}
          saveDirs={subDirs}
        />
      ),
    })
    if (!updated) return

    const idx = current.findIndex((m) => m.name === target.name && m.link === target.link)
    if (idx < 0) return

    const next = [...current]
    const merged: ModuleInfo = { ...target, ...updated }

    if (merged.name) {
      const nameExists = current.some((m, i) => i !== idx && m.name === merged.name)
      if (nameExists) {
        await Dialog.alert({ message: "模块名称已存在" })
        return
      }
    }

    if (merged.link) {
      const linkExists = current.some((m, i) => i !== idx && m.link === merged.link)
      if (linkExists) {
        await Dialog.alert({ message: "下载链接已存在" })
        return
      }
    }

    if (!(await Dialog.confirm({ title: "保存模块修改", message: `将修改 ${target.name} 的文件内容、分类或保存位置。继续？` }))) return
    setBusy(true)
    setStage("修改模块中…")
    setProgress(null)
    try {
      next[idx] = merged
      const finalName = merged.name || target.name
      const finalSaveDir = merged.saveDir ?? originalSaveDir
      const needMove =
        finalName !== target.name ||
        String(finalSaveDir ?? "") !== String(originalSaveDir ?? "")
      const finalFilePath = needMove
        ? await moveModuleFile(target, finalSaveDir, finalName)
        : (target.filePath ?? moduleFilePath(finalName, finalSaveDir))

      if (merged.isLocal || !merged.link) {
        await saveLocalModule(
          { ...merged, name: finalName, saveDir: finalSaveDir, filePath: finalFilePath },
          merged.content ?? ""
        )
      } else {
        await updateModuleMetadata({ ...merged, name: finalName, filePath: finalFilePath }, {
          link: merged.link,
          category: merged.category,
          local: false,
        })
      }
      await refreshModules()
      setStage("修改完成")
    } catch (e: any) {
      setStage(`修改失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function viewModuleContent(target: ModuleInfo) {
    try {
      const fm: any = (globalThis as any).FileManager
      if (!fm?.readAsString) throw new Error("FileManager.readAsString 不可用")
      const path = target.filePath ?? moduleFilePath(target.name)
      const text = await fm.readAsString(path)
      if (!text) {
        await Dialog.alert({ message: "模块内容为空或读取失败" })
        return
      }
      const controller = new (globalThis as any).EditorController({
        content: String(text),
        ext: "txt",
        readOnly: true,
      })
      try {
        await controller.present({ navigationTitle: target.name, fullscreen: true })
      } finally {
        controller.dispose()
      }
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    }
  }

  async function deleteModuleFor(target: ModuleInfo) {
    const ok = await Dialog.confirm({
      title: "删除模块",
      message: `确定删除模块：${target.name}？`,
    })
    if (!ok) return

    setBusy(true)
    setStage("删除模块中…")
    setProgress(null)
    try {
      await removeModuleFile(target)
      await refreshModules()
      setStage("删除完成")
    } catch (e: any) {
      setStage(`删除失败：${String(e?.message ?? e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function copyModuleLink(target: ModuleInfo) {
    try {
      await Pasteboard.setString(target.link)
      await Dialog.alert({ message: "链接已复制" })
    } catch (e: any) {
      await Dialog.alert({ message: String(e?.message ?? e) })
    }
  }

  async function downloadSingle(target: ModuleInfo) {
    if (!target.link?.trim()) {
      await Dialog.alert({ message: "本地模块无下载链接，无法更新" })
      return
    }
    await downloadBatch([target], `下载模块：${target.name}`)
  }

  async function downloadBatch(list: ModuleInfo[], title: string) {
    const downloadable: ModuleInfo[] = list.filter((m: ModuleInfo): boolean => !!m.link?.trim())
    if (!downloadable.length) {
      await Dialog.alert({ message: "暂无可下载模块" })
      return
    }

    const confirmed: boolean = await Dialog.confirm({
      title: "确认更新模块",
      message: `将下载并覆盖当前筛选的 ${downloadable.length} 个模块文件。是否继续？`,
      confirmLabel: "更新并覆盖",
      cancelLabel: "取消",
    })
    if (!confirmed) return

    setBusy(true)
    setStage(title)
    setProgress(null)
    const errors: string[] = []
    let okCount = 0
    try {
      const total = downloadable.length
      let nextIndex = 0
      let completed = 0
      const concurrency = Math.max(1, Math.min(cfg.downloadConcurrency || 3, total))

      const updateOverallProgress = () => {
        setStage(`下载中：已完成 ${completed}/${total}`)
        setProgress(completed / total)
      }

      updateOverallProgress()

      async function worker() {
        for (;;) {
          const idx = nextIndex
          nextIndex += 1
          if (idx >= total) return

          const m = downloadable[idx]
          const linkPrefix = await detectLinkPrefix(m)
          const res = await downloadModule({ ...m, saveDir: inferSaveDir(m), linkPrefix, overwriteConfirmed: true })
          if (res.ok) okCount += 1
          else errors.push(`${m.name}: ${res.message ?? "下载失败"}`)

          completed += 1
          updateOverallProgress()
        }
      }

      const workers = Array.from({ length: concurrency }, () => worker())
      await Promise.all(workers)

      if (errors.length) {
        setStage(`下载完成：成功 ${okCount}/${total}`)
        await Dialog.alert({
          title: "部分下载失败",
          message: errors.slice(0, 6).join("\n"),
        })
      } else {
        setStage(`下载完成：${okCount}/${total}`)
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      setStage(`下载失败：${msg}`)
      await Dialog.alert({ title: "下载失败", message: msg })
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function downloadAll() {
    const current = await loadModules()
    const list: ModuleInfo[] = current.filter(matchFilters)
    await downloadBatch(list, "下载全部模块…")
  }

  async function toggleRemoteModule(target: ModuleInfo, nextValue: boolean) {
    if (scanPending.current || actionLock.current || busy || togglingModuleNames.size > 0) return
    const remoteName = getModuleRemoteName(target)
    if (!remoteControlReady) {
      await Dialog.alert({ message: "请先配置 HTTP 远程控制端口" })
      return
    }
    if (!remoteName) {
      await Dialog.alert({ message: "未找到模块远程名称" })
      return
    }

    remoteGeneration.current += 1
    HapticFeedback.heavyImpact()
    setTogglingModuleNames((prev) => new Set([...prev, remoteName]))
    setEnabledModuleNames((prev) => {
      const next = new Set(prev)
      if (nextValue) next.add(remoteName)
      else next.delete(remoteName)
      return next
    })

    try {
      await setRemoteModuleEnabled(cfg, remoteName, nextValue)
    } catch (e: any) {
      setEnabledModuleNames((prev) => {
        const next = new Set(prev)
        if (nextValue) next.delete(remoteName)
        else next.add(remoteName)
        return next
      })
      await Dialog.alert({
        title: "远程控制失败",
        message: `${remoteName}\n${String(e?.message ?? e)}`,
      })
    } finally {
      setTogglingModuleNames((prev) => {
        const next = new Set(prev)
        next.delete(remoteName)
        return next
      })
    }
  }


  return (
    <List listStyle="insetGroup">
      {/* Own the List; selection chrome is a stable sibling, never a row. */}
        <Section>
          <HStack spacing={12}>
            <ActionTileButton title="添加" systemImage="plus.square.on.square" tint="systemBlue" onPress={withButtonHaptic(addModule, false)} disabled={scanning || busy || togglingModuleNames.size > 0} />
            <ActionTileButton title="更新" systemImage="arrow.triangle.2.circlepath.circle.fill" tint="systemGreen" onPress={withButtonHaptic(downloadAll, false)} disabled={scanning || busy || togglingModuleNames.size > 0 || !filteredModules.length || onlyLocalFiltered} />
          </HStack>
          <TextField title="搜索模块" value={query} prompt="搜索模块 · 名称 / 分类" frame={{ maxWidth: "infinity", minHeight: 44 }} onChanged={(value: string): void => setQuery(value)} />
          <HStack spacing={8}>
            <Text font="caption" foregroundStyle="secondaryLabel" fixedSize={{ horizontal: false, vertical: true }}>{`${filteredModules.length}/${modules.length} 个模块 · ${scanning ? "读取中…" : stage} · ${remoteStatus}`}</Text>
            <Spacer />
            <Button title="刷新" buttonStyle="bordered" font="caption" fixedSize={true} action={withButtonHaptic(async (): Promise<void> => { await refreshModules(true); await refreshRemoteModules(false) })} disabled={scanning || busy || togglingModuleNames.size > 0} />
          </HStack>
          {progress !== null ? (
            <ProgressView
              value={progress}
              total={1}
              progressViewStyle="linear"
              frame={{ maxWidth: "infinity" }}
            />
          ) : null}
        </Section>

        <Section
          header={(
            <HStack>
              <Text>
                {filteredModules.length > 0
                  ? `模块列表(${filteredModules.length})`
                  : "模块列表"}
              </Text>
              <Spacer />
              {dirOptions.length > 1 ? (
                <Picker
                  title="子文件夹"
                  pickerStyle="menu"
                  value={Math.max(0, dirOptions.indexOf(filterDir))}
                  onChanged={(idx: number) => {
                    HapticFeedback.heavyImpact()
                    setFilterDir(dirOptions[idx] ?? "全部")
                  }}
                >
                  {dirOptions.map((d, idx) => (
                    <Text key={`${d}-${idx}`} tag={idx}>
                      {d}
                    </Text>
                  ))}
                </Picker>
              ) : null}
              <Picker
                title="筛选分类"
                pickerStyle="menu"
                value={filterIdx}
                onChanged={(idx: number) => {
                  HapticFeedback.heavyImpact()
                  setFilterCategory(filterOptions[idx] ?? "全部")
                }}
              >
                {filterOptions.map((c, idx) => (
                  <Text key={`${c}-${idx}`} tag={idx}>
                    {c}
                  </Text>
                ))}
              </Picker>
            </HStack>
          )}
        >
          {filteredModules.length === 0 ? (
            <Text>暂无模块</Text>
          ) : (
            filteredModules.map((m) => (
              (() => {
                const remoteName = getModuleRemoteName(m)
                return (
                  <VStack
                    key={m.filePath ?? `${m.name}-${m.link}`}
                    disabled={scanning || busy || togglingModuleNames.size > 0}
                    transition={Transition.opacity()}
                    contextMenu={{
                      menuItems: (
                        <Group>
                          <Button title="查看模块" action={withButtonHaptic(() => viewModuleContent(m))} />
                          <Button title="复制链接" action={withButtonHaptic(() => copyModuleLink(m))} />
                          <Button title="删除" role="destructive" action={withButtonHaptic(() => deleteModuleFor(m))} />
                        </Group>
                      ),
                    }}
                    leadingSwipeActions={{
                      allowsFullSwipe: false,
                      actions: [
                        <Button title="编辑" tint="systemOrange" disabled={scanning || busy || togglingModuleNames.size > 0} action={withButtonHaptic(() => modifyModuleFor(m))} />,
                      ],
                    }}
                    trailingSwipeActions={{
                      allowsFullSwipe: false,
                      actions: [
                        <Button
                          title="更新"
                          tint={m.link?.trim() ? "systemGreen" : "systemGray"}
                          disabled={scanning || busy || togglingModuleNames.size > 0 || !m.link?.trim()}
                          action={withButtonHaptic(() => downloadSingle(m))}
                        />,
                      ],
                    }}
                  >
                    <HStack>
                      <VStack alignment="leading" spacing={3}>
                        <Text font="headline">{m.name}</Text>
                        {m.category ? (
                          <Text font="caption" foregroundStyle="secondaryLabel">
                            {m.category}
                          </Text>
                        ) : null}
                      </VStack>
                      <Spacer />
                      <Toggle
                        title=""
                        value={enabledModuleNames.has(remoteName)}
                        disabled={scanning || !remoteControlReady || remoteStatus !== "远程已连接" || togglingModuleNames.has(remoteName)}
                        toggleStyle="switch"
                        onChanged={(value: boolean) => {
                          void toggleRemoteModule(m, value)
                        }}
                      />
                    </HStack>
                    <HStack spacing={16} buttonStyle="borderless">
                      <Button title="查看" action={withButtonHaptic(() => viewModuleContent(m))} />
                      <Spacer />
                      <Text font="caption2" foregroundStyle="secondaryLabel">{getTopDir(m) || "根目录"}</Text>
                    </HStack>
                  </VStack>
                )
              })()
            ))
          )}
        </Section>
    </List>
  )
}
