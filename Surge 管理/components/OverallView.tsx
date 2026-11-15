import { Button, Group, HStack, Image, RoundedRectangle, List, Navigation, NavigationStack, ProgressView, Section, Spacer, Text, TextField, VStack, ZStack, useEffect, useRef, useState } from "scripting"
import { BatchProgress } from "./BatchProgress"
import { loadConfig } from "../utils/config"
import { runBatchPool, type BatchResult, type BatchSnapshot } from "../utils/batch_pool"
import { ScopeTabs } from "./ScopeTabs"
import { RuleEditor } from "./RuleEditor"
import { HomeView } from "./HomeView"
import { ActionTileButton } from "./ActionTileButton"
import { ResourceSearchBar } from "./ResourceSearchBar"
import { ResourceOverview } from "./ResourceOverview"
import { UpdateBadge } from "./UpdateBadge"
import { baseStatus, cachedUpdateStates, checkForUpdates, checkTarget, updateSummary, type UpdateStatus } from "../utils/update_check"
import { SettingsView } from "./SettingsView"
import { bindResourceSource, savedBookmark, type RuleBatchAuthorization, beginResourceEdit, saveResourceEdit, type ResourceEdit, deleteResource, downloadResource, listResources, resolveDirectory, type ResourceFile } from "../utils/resources"
import { resourceLabel, suggestedName, validateURL, type Destination, type ResourceKind } from "../utils/resource_policy"
import { type DownloadProgress } from "../utils/stream_downloader"
import { animateState, motionEnabled, playFeedback } from "../utils/motion"

type Scope = { kind: ResourceKind; destination: Destination }
const SCOPE_KEY: string = "surge_overall_scope_v1"
function savedScope(): Scope {
  const raw: Partial<Scope> | null = Storage.get<Partial<Scope>>(SCOPE_KEY)
  return { kind: raw?.kind === "rule" ? "rule" : "module", destination: "surge" }
}

export function OverallView(props: { initialKind?: ResourceKind; initialQuery?: string } = {}) {
  // 预览可指定初始页；正常启动仍恢复用户最后选择，不写入测试偏好。
  const [initialScope] = useState<Scope>(() => props.initialKind ? { kind: props.initialKind, destination: "surge" } : savedScope())
  const [kind, setKind] = useState<ResourceKind>(initialScope.kind)
  const destination: Destination = "surge"
  const [modulesVisited, setModulesVisited] = useState<boolean>(initialScope.kind === "module" && initialScope.destination === "surge")
  const [files, setFiles] = useState<ResourceFile[]>([])
  const [directory, setDirectory] = useState<string>("")
  const [status, setStatus] = useState<string>("读取中…")
  const [busy, setBusy] = useState<boolean>(false)
  const [moduleBusy, setModuleBusy] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(true)
  const [revision, setRevision] = useState<number>(0)
  const [progress, setProgress] = useState<number | null>(null)
  const [batchProgress, setBatchProgress] = useState<BatchSnapshot | null>(null)
  const [updateStates, setUpdateStates] = useState<Record<string, UpdateStatus>>({})
  const [query, setQuery] = useState<string>(props.initialKind === "rule" ? props.initialQuery ?? "" : "")
  const [expanded, setExpanded] = useState<string>("")
  const [content, setContent] = useState<string>("")
  const [editing, setEditing] = useState<ResourceEdit | null>(null)
  const [draft, setDraft] = useState<string>("")
  const lock: { current: boolean } = useRef<boolean>(false)
  const generation: { current: number } = useRef<number>(0)
  const label: string = resourceLabel(kind)
  const managedModules: boolean = kind === "module" && destination === "surge"
  const blocked: boolean = busy || moduleBusy || loading || editing !== null
  const visible: ResourceFile[] = files.filter((file: ResourceFile): boolean => file.name.toLowerCase().includes(query.trim().toLowerCase()))

  function updateState(file: ResourceFile): UpdateStatus { return updateStates[file.path] ?? baseStatus(file.link) }

  async function refresh(checkUpdates: boolean = false): Promise<void> {
    const token: number = ++generation.current
    if (managedModules) {
      // HomeView owns module authorization and scanning; do not resolve it twice.
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const dir: string = await resolveDirectory(kind, destination)
      const next: ResourceFile[] = managedModules ? [] : await listResources(dir, kind)
      if (token !== generation.current) return
      setDirectory(dir)
      setFiles(next)
      const targets = next.map(file => checkTarget(file.path, file.link, kind))
      const cached = await cachedUpdateStates(targets)
      if (token !== generation.current) return
      setUpdateStates(cached)
      if (checkUpdates) {
        setStatus("正在检查来源更新…")
        const states = await checkForUpdates(targets, (path, state, completed): void => {
          if (token !== generation.current) return
          setUpdateStates(previous => ({ ...previous, [path]: state }))
          setStatus(`检查更新 ${completed}/${next.length} · 不覆盖文件`)
        }, (): boolean => token === generation.current)
        if (token !== generation.current) return
        setUpdateStates(states)
        setStatus(`${updateSummary(Object.values(states))} · 5 分钟内复用缓存`)
      } else setStatus("刷新检查更新 · 长按文件可添加或修改来源")
      setLoading(false)
    } catch (error: unknown) {
      if (token !== generation.current) return
      setDirectory("")
      setFiles([])
      setUpdateStates({})
      setStatus(String(error instanceof Error ? error.message : error))
      setLoading(false)
    }
  }

  useEffect((): (() => void) => {
    void refresh()
    return (): void => { generation.current += 1 }
  }, [kind, destination, revision])

  async function perform(action: () => Promise<void>): Promise<void> {
    if (lock.current || busy || moduleBusy || loading) return
    lock.current = true
    setBatchProgress(null)
    setBusy(true)
    try {
      await action()
    } catch (error: unknown) {
      const message: string = String(error instanceof Error ? error.message : error)
      setStatus(message)
      await Dialog.alert({ title: "操作未完成", message })
    } finally {
      lock.current = false
      setBusy(false)
      setProgress(null)
    }
  }

  function switchScope(nextKind: ResourceKind, nextDestination: Destination): void {
    if (lock.current || busy || moduleBusy || editing !== null || (nextKind === kind && nextDestination === destination)) return
    Storage.set<Scope>(SCOPE_KEY, { kind: nextKind, destination: nextDestination })
    generation.current += 1
    setDirectory("")
    setFiles([])
    setUpdateStates({})
    setStatus("读取中…")
    setExpanded("")
    setContent("")
    setQuery("")
    setBatchProgress(null)
    setLoading(!(nextKind === "module" && nextDestination === "surge"))
    if (nextDestination !== destination) setModulesVisited(nextKind === "module" && nextDestination === "surge")
    else if (nextKind === "module" && nextDestination === "surge") setModulesVisited(true)
    setKind(nextKind)
  }

  async function openSettings(): Promise<void> {
    await Navigation.present({ element: <SettingsView /> })
    generation.current += 1
    setFiles([])
    setDirectory("")
    setModulesVisited(managedModules)
    setRevision((value: number): number => value + 1)
  }

  async function editSource(file: ResourceFile): Promise<void> {
    const input: unknown = await Dialog.prompt({ title: file.link ? "修改来源" : "添加来源", message: `${file.name}\n只绑定下载链接，不修改文件正文。`, defaultValue: file.link, placeholder: "https://…", confirmLabel: "保存来源" })
    if (typeof input !== "string" || !input.trim()) return
    await bindResourceSource(kind, destination, file, validateURL(input))
    await refresh()
    setStatus(`已保存来源：${file.name} · 点击刷新检查更新`)
  }

  async function download(file?: ResourceFile): Promise<void> {
    if (file && !file.link.trim()) throw new Error("此文件无更新来源，请长按文件添加来源")
    // 已绑定文件直接使用默认来源；修改链接由独立的长按菜单负责。
    const input: unknown = file ? file.link : await Dialog.prompt({ title: `下载${label}`, message: "输入 HTTP / HTTPS 链接，保存后自动作为此文件的更新来源。", defaultValue: "", placeholder: "https://…" })
    if (typeof input !== "string" || !input.trim()) { setStatus("未输入链接，未创建或修改文件"); return }
    const url: string = validateURL(input)
    const name: unknown = file?.name ?? await Dialog.prompt({ title: "保存文件名", message: `保存到：${directory || "所选书签文件夹"}`, defaultValue: suggestedName(url, kind) })
    if (typeof name !== "string" || !name.trim()) { setStatus("未输入文件名，未创建或修改文件"); return }
    setStatus(`正在下载：${name}`)
    const path: string | null = await downloadResource(kind, destination, name, url, (value: DownloadProgress): void => {
      setProgress(value.percent ?? null)
      setStatus(`正在下载：${name} · ${Math.round(value.received / 1024)} KB`)
    }, undefined, file)
    setExpanded("")
    await refresh()
    setStatus(path ? `已保存：${name}` : "已取消，未覆盖文件")
  }

  async function updateVisible(): Promise<void> {
    // Snapshot the current search result; perform() holds the operation lock throughout.
    const selected: ResourceFile[] = visible.map((file: ResourceFile): ResourceFile => ({ ...file }))
    const candidates: ResourceFile[] = selected.filter((file: ResourceFile): boolean => {
      if (updateState(file).state !== "available") return false
      if (kind !== "rule") return !!file.link.trim()
      try { validateURL(file.link); return true } catch { return false }
    }).map((file: ResourceFile): ResourceFile => ({ ...file, link: kind === "rule" ? validateURL(file.link) : file.link }))
    if (!candidates.length) {
      setStatus("没有已确认的更新，请先点击刷新检查")
      return
    }
    const batch: RuleBatchAuthorization | undefined = kind === "rule" ? Object.freeze({
      kind: "rule",
      destination,
      directory,
      bookmark: destination === "surge" ? savedBookmark(kind) : "",
      files: Object.freeze(candidates.map((file: ResourceFile): Readonly<ResourceFile> => Object.freeze({ ...file }))),
    }) : undefined
    const confirmed: boolean = await Dialog.confirm({
      title: `批量更新${label}`,
      message: `当前搜索筛选共 ${selected.length} 个文件，将更新其中 ${candidates.length} 个；未确认有变化的 ${selected.length - candidates.length} 个将跳过。目标：${directory || "所选书签文件夹"}。${batch ? "确认后将自动下载并覆盖以上筛选范围的分流文件，不再逐个确认；单项失败继续。" : "每个已有文件仍会单独确认覆盖，取消该文件则跳过。"}继续？`,
      confirmLabel: batch ? "全部更新并覆盖" : "继续逐项确认",
      cancelLabel: "取消",
    })
    if (!confirmed) return
    if (batch) {
      const concurrency: number = loadConfig().downloadConcurrency
      setStatus("正在批量更新分流…")
      const result: BatchResult = await runBatchPool<ResourceFile>(
        candidates, concurrency, (file: ResourceFile): string => file.name,
        (file: ResourceFile, report: (value: DownloadProgress) => void): Promise<string | null> =>
          downloadResource(kind, destination, file.name, file.link, report, batch),
        (snapshot: BatchSnapshot): void => setBatchProgress(snapshot)
      )
      setExpanded("")
      setContent("")
      await refresh()
      const summary: string = `更新完成 · 成功 ${result.succeeded} · 失败 ${result.failed} · 跳过 ${selected.length - candidates.length + result.skipped}`
      setStatus(summary)
      if (result.errors.length) await Dialog.alert({ title: summary, message: result.errors.slice(0, 6).join("\n") })
      return
    }
    let succeeded: number = 0
    let failed: number = 0
    let skipped: number = selected.length - candidates.length
    const errors: string[] = []
    for (const file of candidates) {
      try {
        setProgress(null)
        setStatus(`正在更新：${file.name}`)
        const path: string | null = await downloadResource(kind, destination, file.name, file.link, (value: DownloadProgress): void => {
          setProgress(value.percent ?? null)
          setStatus(`正在更新：${file.name} · ${Math.round(value.received / 1024)} KB`)
        }, batch)
        if (path) succeeded += 1
        else skipped += 1
      } catch (error: unknown) {
        failed += 1
        errors.push(`${file.name}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    setExpanded("")
    await refresh()
    const summary: string = `更新完成 · 成功 ${succeeded} · 失败 ${failed} · 跳过 ${skipped}`
    setStatus(summary)
    if (errors.length) await Dialog.alert({ title: summary, message: errors.slice(0, 6).join("\n") })
  }

  async function showContent(file: ResourceFile): Promise<void> {
    if (expanded === file.path) {
      animateState((): void => setExpanded(""))
      return
    }
    const text: string = await FileManager.readAsString(file.path)
    animateState((): void => {
      setContent(text)
      setExpanded(file.path)
    })
  }

  async function editContent(file: ResourceFile): Promise<void> {
    const edit: ResourceEdit = await beginResourceEdit(kind, destination, file)
    if (kind === "rule") {
      // perform() retains the parent operation lock for the entire modal lifetime.
      const saved: boolean | undefined = await Navigation.present<boolean>({
        element: <RuleEditor name={file.name} original={edit.original} save={(text: string): Promise<boolean> => saveResourceEdit(edit, text)} />,
        modalPresentationStyle: "pageSheet",
      })
      if (saved) {
        setExpanded("")
        setContent("")
        await refresh()
        setStatus("原文修改已保存")
      }
      return
    }
    animateState((): void => {
      setExpanded("")
      setDraft(edit.original)
      setEditing(edit)
    })
  }

  async function saveContent(): Promise<void> {
    if (!editing) return
    if (await saveResourceEdit(editing, draft)) {
      animateState((): void => { setEditing(null); setDraft("") })
      await refresh()
      setStatus("原文修改已保存")
    }
  }

  async function cancelEdit(): Promise<void> {
    if (editing && draft !== editing.original && !(await Dialog.confirm({ title: "放弃修改", message: "未保存的原文修改将丢失。继续？" }))) return
    animateState((): void => { setEditing(null); setDraft("") })
  }

  const settingsButton: JSX.Element = <Button title="设置" systemImage="gearshape" foregroundStyle="label" disabled={blocked} action={(): void => { void perform(openSettings) }} />
  const scopeSection: JSX.Element = (
          <VStack spacing={8} alignment="leading" padding={{ horizontal: 20, top: 8 }}>
          <ScopeTabs value={kind} disabled={busy || moduleBusy || editing !== null} onChanged={(value: ResourceKind): void => switchScope(value, destination)} />
          </VStack>
  )

  return (
    <NavigationStack>
      <VStack spacing={0} navigationTitle="Surge 资源库" navigationBarTitleDisplayMode="inline" toolbar={{ topBarTrailing: settingsButton }}>
        {scopeSection}
        <ZStack>
          {/* Lazy first visit, then stable identity. No animation transaction reaches either List. */}
          {modulesVisited && destination === "surge" ? <VStack spacing={0} opacity={managedModules ? 1 : 0} allowsHitTesting={managedModules} accessibilityHidden={!managedModules}>
            <HomeView key={`modules-${revision}`} onBusyChanged={setModuleBusy} active={managedModules} initialQuery={props.initialKind === "module" ? props.initialQuery : undefined} />
          </VStack> : null}
        <VStack spacing={0} opacity={managedModules ? 0 : 1} allowsHitTesting={!managedModules} accessibilityHidden={managedModules}>
          <VStack padding={{ horizontal: 20, top: 12, bottom: 4 }}>
            <ResourceSearchBar value={query} onChanged={setQuery} prompt="搜索分流文件名" accent="systemBlue" active={!managedModules} />
          </VStack>
        <List listStyle="insetGroup" scrollDismissesKeyboard="interactively" listSectionSpacing={18} contentMargins={{ edges: "top", insets: 12 }} tint="systemBlue">
          <Section>
            <VStack spacing={0} listRowInsets={0} listRowSeparator="hidden" listRowBackground={<RoundedRectangle cornerRadius={24} fill="clear" />}>
              <ResourceOverview count={visible.length} total={files.length} title={query.trim() ? "搜索结果" : "分流资源库"}
                detail={`${visible.filter(file => updateState(file).state === "available").length} 个有更新 · ${visible.filter(file => !!file.link.trim()).length} 个有来源`}
                status={loading ? "正在读取本地文件…" : status} connection={directory ? "目录已连接" : "目录未就绪"}
                available={!!directory} working={busy || loading} accent="systemBlue" refreshDisabled={blocked}
                onRefresh={(): Promise<void> => perform(() => refresh(true))}>
                <HStack spacing={10} frame={{ maxWidth: "infinity", height: 50 }}>
                  <ActionTileButton title="添加分流" systemImage="plus" tint="systemBlue" disabled={blocked || !directory} onPress={(): Promise<void> => perform((): Promise<void> => download())} />
                  <ActionTileButton title="更新变化" systemImage="arrow.down" tint="systemBlue" disabled={blocked || !directory || !visible.some((file: ResourceFile): boolean => updateState(file).state === "available")} onPress={(): Promise<void> => perform(updateVisible)} />
                </HStack>
                {batchProgress ? <BatchProgress snapshot={batchProgress} /> : progress !== null ? <ProgressView value={progress} total={1} progressViewStyle="linear" /> : null}
              </ResourceOverview>
            </VStack>
          </Section>
          <Section header={<Text>{`${label}文件 · ${visible.length}/${files.length}`}</Text>}>
            {!loading && visible.length === 0 ? <VStack spacing={10} padding={{ vertical: 22 }} frame={{ maxWidth: "infinity" }}>
              <Image systemName={query.trim() ? "magnifyingglass" : "folder"} font={28} foregroundStyle="tertiaryLabel" />
              <Text font="headline">{query.trim() ? "没有找到匹配项" : "等待添加分流"}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel" multilineTextAlignment="center">{!directory ? "请先在设置中选择分流文件夹。" : query.trim() ? "试试其他文件名，也可以清空搜索。" : "下载分流文件，或选择已有文件的书签目录。"}</Text>
            </VStack> : null}
            {visible.map((file: ResourceFile) => (
              <VStack key={file.path} alignment="leading" spacing={12} padding={{ vertical: 5 }} transition={Transition.opacity()}
                contextMenu={{ menuItems: <Group>
                  <Button title={file.link.trim() ? "修改来源" : "添加来源"} systemImage="link.badge.plus" disabled={blocked} action={(): void => { void perform(() => editSource(file)) }} />
                  <Button title="检查详情" systemImage="info.circle" disabled={blocked} action={(): void => { void perform(async () => { const state = updateState(file); await Dialog.alert({ title: file.name, message: `${state.detail}${state.checkedAt ? `\n检查时间：${new Date(state.checkedAt).toLocaleString()}` : ""}` }) }) }} />
                  <Button title="编辑原文" systemImage="square.and.pencil" disabled={blocked} action={(): void => { void perform((): Promise<void> => editContent(file)) }} />
                  <Button title="删除文件" systemImage="trash" role="destructive" disabled={blocked} action={(): void => { void perform(async (): Promise<void> => { if (await deleteResource(file)) { setExpanded(""); await refresh() } }) }} />
                </Group> }}
                leadingSwipeActions={{ allowsFullSwipe: false, actions: [
                  <Button title="编辑" tint="systemOrange" disabled={blocked} action={(): void => { void perform((): Promise<void> => editContent(file)) }} />,
                ] }}
                trailingSwipeActions={{ allowsFullSwipe: false, actions: [
                  <Button title="更新" tint={file.link.trim() ? "systemGreen" : "systemGray"} disabled={blocked || !file.link.trim()} action={(): void => { void perform((): Promise<void> => download(file)) }} />,
                ] }}
              >
                <Button buttonStyle="plain" disabled={blocked} accessibilityLabel={`${expanded === file.path ? "收起" : "预览"} ${file.name}`}
                  action={(): void => { playFeedback(() => HapticFeedback.softImpact()); void perform((): Promise<void> => showContent(file)) }}>
                  <HStack spacing={12} frame={{ minHeight: 54 }}>
                    <Image systemName={file.link.trim() ? "arrow.triangle.branch" : "doc.text"} font={20} foregroundStyle="systemBlue"
                      frame={{ width: 40, height: 40 }} background={{ style: "quaternarySystemFill", shape: { type: "rect", cornerRadius: 12 } }} />
                    <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                      <Text font="subheadline" fontWeight="semibold" foregroundStyle="label" lineLimit={2}>{file.name}</Text>
                      <UpdateBadge status={updateState(file)} />
                    </VStack>
                    <Image systemName="chevron.right" font={12} fontWeight="semibold" foregroundStyle="tertiaryLabel"
                      rotationEffect={expanded === file.path ? 90 : 0}
                      animation={motionEnabled() ? { animation: Animation.spring({ duration: 0.25, bounce: 0 }), value: expanded === file.path } : undefined} />
                  </HStack>
                </Button>
                {kind === "module" && editing?.file.path === file.path ? <VStack alignment="leading" spacing={8} transition={Transition.opacity()}>
                  <Text font="caption" foregroundStyle="secondaryLabel">原文编辑 · 保存将覆盖文件内容</Text>
                  <TextField title="文件原文" axis="vertical" lineLimit={{ min: 6, max: 16 }} value={draft} disabled={busy} onChanged={(value: string): void => setDraft(value)} />
                  <HStack spacing={12} buttonStyle="bordered">
                    <Button title="保存" disabled={busy || draft === editing.original} action={(): void => { void perform(saveContent) }} />
                    <Button title="取消" disabled={busy} action={(): void => { void perform(cancelEdit) }} />
                  </HStack>
                </VStack> : null}
                {expanded === file.path ? <VStack alignment="leading" spacing={4} transition={Transition.opacity()}>
                  <Text font="caption" monospaced textSelection={true} lineLimit={8} padding={12}
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                    background={{ style: "tertiarySystemFill", shape: { type: "rect", cornerRadius: 12 } }}>{content.slice(0, 4000) || "（空文件）"}</Text>
                  {content.length > 0 ? <Button title="打开完整原文" disabled={blocked} action={(): void => { void perform(async (): Promise<void> => { await Navigation.present({ element: <NavigationStack><List navigationTitle={file.name}><Text textSelection={true}>{content}</Text></List></NavigationStack> }) }) }} /> : null}
                </VStack> : null}
              </VStack>
            ))}
          </Section>
        </List>
        </VStack>
        </ZStack>
      </VStack>
    </NavigationStack>
  )
}

export default OverallView
