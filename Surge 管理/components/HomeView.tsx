import {
  Button,
  Group,
  DisclosureGroup,
  HStack,
  Image,
  RoundedRectangle,
  List,
  Navigation,
  ProgressView,
  Section,
  Spacer,
  Text,
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
import { ResourceSearchBar } from "./ResourceSearchBar"
import { ResourceOverview } from "./ResourceOverview"
import { UpdateBadge } from "./UpdateBadge"
import { baseStatus, cachedUpdateStates, checkForUpdates, checkTarget, updateSummary, type UpdateStatus } from "../utils/update_check"
import { CategoryLabel } from "./CategoryLabel"
import { animateState, playFeedback } from "../utils/motion"
import { groupModules } from "../utils/module_groups"
import { resolveDirectory } from "../utils/resources"
import {
  fetchEnabledModuleNames,
  getModuleRemoteName,
  setRemoteModuleEnabled,
} from "../utils/remote_control"

export function HomeView(props: { onBusyChanged?: (busy: boolean) => void; active?: boolean; initialQuery?: string }) {
  const scanPending: { current: boolean } = useRef<boolean>(true)
  const [scanning, setScanning] = useState<boolean>(true)
  const scanGeneration: { current: number } = useRef<number>(0)
  const remoteGeneration: { current: number } = useRef<number>(0)
  const actionLock: { current: boolean } = useRef<boolean>(false)
  const withButtonHaptic: (action: () => void | Promise<void>, haptic?: boolean) => () => Promise<void> = (action: () => void | Promise<void>, haptic: boolean = true) => async (): Promise<void> => {
    if (scanPending.current || actionLock.current || busy || togglingModuleNames.size > 0) return
    actionLock.current = true
    try {
      setBusy(true)
      if (haptic) playFeedback(() => HapticFeedback.softImpact())
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
  const [query, setQuery] = useState<string>(props.initialQuery ?? "")
  const [modules, setModules] = useState<ModuleInfo[]>([])
  const [updateStates, setUpdateStates] = useState<Record<string, UpdateStatus>>({})
  const [stage, setStage] = useState("就绪")
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [resolvedBaseDir, setResolvedBaseDir] = useState("")
  const [expandedCategories, setExpandedCategories] = useState<Map<string, boolean>>(new Map())
  const [enabledModuleNames, setEnabledModuleNames] = useState<Set<string>>(new Set())
  const [togglingModuleNames, setTogglingModuleNames] = useState<Set<string>>(new Set())
  const [remoteStatus, setRemoteStatus] = useState<string>("远程状态读取中")
  useEffect((): void => { props.onBusyChanged?.(busy || scanning || togglingModuleNames.size > 0) }, [busy, scanning, togglingModuleNames])
  const categories = cfg.categories ?? []
  const baseDir = resolvedBaseDir
  const searching = query.trim().length > 0

  function getTopDir(m: ModuleInfo): string {
    const p = m.filePath ? String(m.filePath) : ""
    if (!p) return ""
    const rel = baseDir ? p.replace(baseDir, "").replace(/^\/+/, "") : p
    return rel.includes("/") ? rel.split("/")[0] : ""
  }

  function matchFilters(m: ModuleInfo): boolean {
    return `${m.name} ${m.category?.trim() || "未分类"} ${getTopDir(m)}`.toLowerCase().includes(query.trim().toLowerCase())
  }

  const filteredModules = modules.filter((m) => {
    return matchFilters(m)
  })
  const moduleGroups = groupModules(filteredModules, categories)
  const hasCategories = modules.some(m => !!m.category?.trim())
  function updateState(module: ModuleInfo): UpdateStatus { return updateStates[module.filePath ?? ""] ?? baseStatus(module.link) }
  const updatesAvailable = filteredModules.filter(module => updateState(module).state === "available").length
  const remoteControlReady = !!String(cfg.remotePort ?? "").trim()

  function inferSaveDir(m: ModuleInfo): string | undefined {
    if (!m.filePath) return undefined
    const idx = String(m.filePath).lastIndexOf("/")
    return idx > 0 ? String(m.filePath).slice(0, idx) : undefined
  }

  async function refreshModules(resetStageOnSuccess: boolean = false, checkUpdates: boolean = false): Promise<void> {
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
      const targets = list.filter(module => !!module.filePath).map(module => checkTarget(module.filePath!, module.link, "module", cfg.linkPatternsText))
      const cached = await cachedUpdateStates(targets)
      if (token !== scanGeneration.current) return
      setUpdateStates(cached)
      if (checkUpdates) {
        setStage("正在检查来源更新…")
        const states = await checkForUpdates(targets, (path, state, completed): void => {
          if (token !== scanGeneration.current) return
          setUpdateStates(previous => ({ ...previous, [path]: state }))
          setStage(`检查更新 ${completed}/${targets.length} · 不覆盖文件`)
        }, (): boolean => token === scanGeneration.current)
        if (token !== scanGeneration.current) return
        setUpdateStates(states)
        setStage(`${updateSummary(Object.values(states))} · 5 分钟内复用缓存`)
      } else if (resetStageOnSuccess) setStage("就绪")
      if (resetStageOnSuccess) setProgress(null)
    } catch (e: any) {
      if (token !== scanGeneration.current) return
      setResolvedBaseDir("")
      setModules([])
      setUpdateStates({})
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
    await refreshModules()
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
          try {
            const linkPrefix = await detectLinkPrefix(m)
            const res = await downloadModule({ ...m, saveDir: inferSaveDir(m), linkPrefix, overwriteConfirmed: true })
            if (res.ok) okCount += 1
            else errors.push(`${m.name}: ${res.message ?? "下载失败"}`)
          } catch (error: unknown) {
            errors.push(`${m.name}: ${error instanceof Error ? error.message : String(error)}`)
          } finally {
            completed += 1
            updateOverallProgress()
          }
        }
      }

      const workers = Array.from({ length: concurrency }, () => worker())
      // 即使某个 worker 出现意外异常，也等所有写入结束，不能提前释放操作锁。
      const settled = await Promise.allSettled(workers)
      for (const result of settled) {
        if (result.status === "rejected") errors.push(`任务异常：${String(result.reason)}`)
      }

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
    const list: ModuleInfo[] = current.filter(module => matchFilters(module) && updateState(module).state === "available"
      && modules.some(displayed => displayed.filePath === module.filePath && displayed.link === module.link))
    if (!list.length) { setStage("没有已确认的更新，请先点击刷新检查"); return }
    await downloadBatch(list, "更新有变化的模块…")
    await refreshModules()
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

    // ref 同步占锁，防止状态刷新前的连续回调重复进入。
    actionLock.current = true
    try {
      remoteGeneration.current += 1
      playFeedback(() => HapticFeedback.softImpact())
      setTogglingModuleNames((prev) => new Set([...prev, remoteName]))
      setEnabledModuleNames((prev) => {
        const next = new Set(prev)
        if (nextValue) next.add(remoteName)
        else next.delete(remoteName)
        return next
      })
      await setRemoteModuleEnabled(cfg, remoteName, nextValue)
      playFeedback(() => HapticFeedback.notificationSuccess())
    } catch (e: any) {
      setEnabledModuleNames((prev) => {
        const next = new Set(prev)
        if (nextValue) next.delete(remoteName)
        else next.add(remoteName)
        return next
      })
      playFeedback(() => HapticFeedback.notificationError())
      await Dialog.alert({
        title: "远程控制失败",
        message: `${remoteName}\n${String(e?.message ?? e)}`,
      })
    } finally {
      actionLock.current = false
      setTogglingModuleNames((prev) => {
        const next = new Set(prev)
        next.delete(remoteName)
        return next
      })
    }
  }


  return (
    <VStack spacing={0}>
      <VStack padding={{ horizontal: 20, top: 12, bottom: 4 }}>
        <ResourceSearchBar value={query} onChanged={setQuery} prompt="搜索名称、分类或文件夹" accent="systemTeal" active={props.active ?? true} />
      </VStack>
    <List listStyle="insetGroup" scrollDismissesKeyboard="interactively" listSectionSpacing={18} contentMargins={{ edges: "top", insets: 12 }} tint="systemTeal">
      {/* Own the List; selection chrome is a stable sibling, never a row. */}
        <Section>
          <VStack spacing={0} listRowInsets={0} listRowSeparator="hidden" listRowBackground={<RoundedRectangle cornerRadius={24} fill="clear" />}>
            <ResourceOverview count={filteredModules.length} total={modules.length} title={searching ? "搜索结果" : "模块资源库"}
              detail={`${moduleGroups.length} 个分类 · ${updatesAvailable} 个有更新`}
              status={scanning ? "正在读取本地文件…" : stage === "就绪" ? searching ? "匹配分类已展开 · 清空搜索恢复折叠" : "刷新检查来源更新 · 侧滑可按来源重下" : stage}
              connection={remoteStatus === "远程已连接" ? "远程已连接" : remoteStatus === "远程未配置" ? "远程未配置" : remoteStatus === "远程状态读取中" ? "正在连接" : "远程不可用 · 状态未知"}
              available={remoteStatus === "远程已连接"} working={scanning || busy || togglingModuleNames.size > 0}
              accent="systemTeal" refreshDisabled={scanning || busy || togglingModuleNames.size > 0}
              onRefresh={withButtonHaptic(async (): Promise<void> => { await Promise.all([refreshModules(true, true), refreshRemoteModules(false)]) }, false)}>
              <HStack spacing={10} frame={{ maxWidth: "infinity", height: 50 }}>
                <ActionTileButton title="添加模块" systemImage="plus" tint="systemTeal" onPress={withButtonHaptic(addModule, false)} disabled={!resolvedBaseDir || scanning || busy || togglingModuleNames.size > 0} />
                <ActionTileButton title="更新变化" systemImage="arrow.down" tint="systemTeal" onPress={withButtonHaptic(downloadAll, false)} disabled={scanning || busy || togglingModuleNames.size > 0 || updatesAvailable === 0} />
              </HStack>
              {progress !== null ? <ProgressView value={progress} total={1} progressViewStyle="linear" /> : null}
            </ResourceOverview>
          </VStack>
        </Section>

        <Section header={<Text>{searching ? "匹配分类" : "分类浏览"}</Text>}> 
          {filteredModules.length === 0 ? (
            <VStack spacing={10} padding={{ vertical: 22 }} frame={{ maxWidth: "infinity" }}>
              <Image systemName={searching ? "magnifyingglass" : "square.stack.3d.up"} font={28} foregroundStyle="tertiaryLabel" />
              <Text font="headline">{scanning ? "正在读取模块" : searching ? "没有找到匹配项" : "模块库还是空的"}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel" multilineTextAlignment="center">{searching ? "试试其他名称、分类或文件夹，也可以清空搜索。" : "添加模块，或在设置中选择模块文件夹。"}</Text>
            </VStack>
          ) : (
            moduleGroups.map(group => <DisclosureGroup key={group.id}
              label={<CategoryLabel title={group.title} count={group.items.length} updates={group.items.filter(m => updateState(m).state === "available").length}
                pending={group.items.filter(m => ["unchecked", "unknown", "error"].includes(updateState(m).state)).length}
                searching={searching} expanded={searching || (expandedCategories.get(group.id) ?? !hasCategories)} />}
              isExpanded={searching || (expandedCategories.get(group.id) ?? !hasCategories)}
              onChanged={(value: boolean): void => {
                if (searching) return
                playFeedback(() => HapticFeedback.selection())
                animateState(() => setExpandedCategories(previous => new Map(previous).set(group.id, value)))
              }}>
            {group.items.map((m) => (
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
                          <Button title="检查详情" action={withButtonHaptic(async () => { const state = updateState(m); await Dialog.alert({ title: m.name, message: `${state.detail}${state.checkedAt ? `\n检查时间：${new Date(state.checkedAt).toLocaleString()}` : ""}` }) })} />
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
                    <HStack spacing={10} padding={{ vertical: 6 }}>
                      <Button buttonStyle="plain" action={withButtonHaptic(() => viewModuleContent(m))}
                        accessibilityLabel={`查看 ${m.name}`} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                        <VStack alignment="leading" spacing={6}>
                          <Text font="subheadline" fontWeight="semibold" foregroundStyle="label" lineLimit={2}>{m.name}</Text>
                          <HStack spacing={5} foregroundStyle="secondaryLabel">
                            <UpdateBadge status={updateState(m)} />
                            <Text font="caption2" lineLimit={1}>{`· ${getTopDir(m) || "根目录"}`}</Text>
                          </HStack>
                        </VStack>
                      </Button>
                      {togglingModuleNames.has(remoteName) ? <ProgressView /> : null}
                      <Toggle
                        title=""
                        accessibilityLabel={`${m.name} 远程开关`}
                        accessibilityHint={remoteStatus === "远程已连接" ? "切换 Surge 中的启用状态" : "远程状态未知，暂时不可切换"}
                        value={enabledModuleNames.has(remoteName)}
                        disabled={scanning || !remoteControlReady || remoteStatus !== "远程已连接" || togglingModuleNames.has(remoteName)}
                        toggleStyle="switch"
                        onChanged={(value: boolean) => {
                          void toggleRemoteModule(m, value)
                        }}
                      />
                    </HStack>
                  </VStack>
                )
              })()
            ))}
            </DisclosureGroup>)
          )}
        </Section>
    </List>
    </VStack>
  )
}
