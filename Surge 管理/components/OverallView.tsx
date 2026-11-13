import { Button, HStack, List, Navigation, NavigationStack, Picker, ProgressView, Section, Spacer, Text, TextField, VStack, ZStack, useEffect, useRef, useState } from "scripting"
import { BatchProgress } from "./BatchProgress"
import { loadConfig } from "../utils/config"
import { runBatchPool, type BatchResult, type BatchSnapshot } from "../utils/batch_pool"
import { ScopeTabs } from "./ScopeTabs"
import { RuleEditor } from "./RuleEditor"
import { HomeView } from "./HomeView"
import { ActionTileButton } from "./ActionTileButton"
import { SettingsView } from "./SettingsView"
import { savedBookmark, type RuleBatchAuthorization, beginResourceEdit, saveResourceEdit, type ResourceEdit, deleteResource, downloadResource, listResources, resolveDirectory, type ResourceFile } from "../utils/resources"
import { resourceLabel, suggestedName, validateURL, type Destination, type ResourceKind } from "../utils/resource_policy"
import { type DownloadProgress } from "../utils/stream_downloader"
import { animateState } from "../utils/motion"

type Scope = { kind: ResourceKind; destination: Destination }
const SCOPE_KEY: string = "surge_overall_scope_v1"
function savedScope(): Scope {
  const raw: Partial<Scope> | null = Storage.get<Partial<Scope>>(SCOPE_KEY)
  return { kind: raw?.kind === "rule" ? "rule" : "module", destination: raw?.destination === "surge" ? "surge" : "local" }
}

export function OverallView() {
  const [initialScope] = useState<Scope>(savedScope)
  const [kind, setKind] = useState<ResourceKind>(initialScope.kind)
  const [destination, setDestination] = useState<Destination>(initialScope.destination)
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
  const [query, setQuery] = useState<string>("")
  const [expanded, setExpanded] = useState<string>("")
  const [content, setContent] = useState<string>("")
  const [editing, setEditing] = useState<ResourceEdit | null>(null)
  const [draft, setDraft] = useState<string>("")
  const lock: { current: boolean } = useRef<boolean>(false)
  const generation: { current: number } = useRef<number>(0)
  const label: string = resourceLabel(kind)
  const managedModules: boolean = kind === "module" && destination === "surge"
  const blocked: boolean = busy || moduleBusy || loading || editing !== null
  const visible: ResourceFile[] = files.filter((file: ResourceFile): boolean => file.name.toLowerCase().includes(query.toLowerCase()))

  async function refresh(): Promise<void> {
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
      setStatus(`${next.length} 个文件 · ${next.filter((file: ResourceFile): boolean => !!file.link).length} 个有更新来源`)
      setLoading(false)
    } catch (error: unknown) {
      if (token !== generation.current) return
      setDirectory("")
      setFiles([])
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
    setStatus("读取中…")
    setExpanded("")
    setContent("")
    setQuery("")
    setBatchProgress(null)
    setLoading(!(nextKind === "module" && nextDestination === "surge"))
    if (nextDestination !== destination) setModulesVisited(nextKind === "module" && nextDestination === "surge")
    else if (nextKind === "module" && nextDestination === "surge") setModulesVisited(true)
    setKind(nextKind)
    setDestination(nextDestination)
  }

  async function openSettings(): Promise<void> {
    await Navigation.present({ element: <SettingsView /> })
    generation.current += 1
    setFiles([])
    setDirectory("")
    setModulesVisited(managedModules)
    setRevision((value: number): number => value + 1)
  }

  async function download(file?: ResourceFile): Promise<void> {
    if (file && !file.link.trim()) throw new Error("此文件无更新来源，无法更新")
    const input: string | null = await Dialog.prompt({ title: file ? `更新 ${file.name}` : `下载${label}`, message: "HTTP / HTTPS 链接；文件原样保存", defaultValue: file?.link ?? "", placeholder: "https://…" })
    if (input === null) return
    const url: string = validateURL(input)
    const name: string | null = file?.name ?? await Dialog.prompt({ title: "保存文件名", message: `保存到：${destination === "local" ? "Scripting 本地" : "Surge 授权目录"}`, defaultValue: suggestedName(url, kind) })
    if (name === null) return
    setStatus(`正在下载：${name}`)
    const path: string | null = await downloadResource(kind, destination, name, url, (value: DownloadProgress): void => {
      setProgress(value.percent ?? null)
      setStatus(`正在下载：${name} · ${Math.round(value.received / 1024)} KB`)
    })
    setExpanded("")
    await refresh()
    setStatus(path ? `已保存：${name}` : "已取消，未覆盖文件")
  }

  async function updateVisible(): Promise<void> {
    // Snapshot the current search result; perform() holds the operation lock throughout.
    const selected: ResourceFile[] = visible.map((file: ResourceFile): ResourceFile => ({ ...file }))
    const candidates: ResourceFile[] = selected.filter((file: ResourceFile): boolean => {
      if (kind !== "rule") return !!file.link.trim()
      try { validateURL(file.link); return true } catch { return false }
    }).map((file: ResourceFile): ResourceFile => ({ ...file, link: kind === "rule" ? validateURL(file.link) : file.link }))
    if (!candidates.length) {
      setStatus(`无可更新来源 · 跳过 ${selected.length}`)
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
      message: `当前搜索筛选共 ${selected.length} 个文件，将更新其中 ${candidates.length} 个；无${batch ? "有效" : ""}来源 ${selected.length - candidates.length} 个将跳过。目标：${destination === "local" ? "Scripting 本地" : "Surge 授权目录"}。${batch ? "确认后将自动下载并覆盖以上筛选范围的分流文件，不再逐个确认；单项失败继续。" : "每个已有文件仍会单独确认覆盖，取消该文件则跳过。"}继续？`,
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

  const settingsButton: JSX.Element = <Button title="设置" systemImage="gearshape" disabled={blocked} action={(): void => { void perform(openSettings) }} />
  const scopeSection: JSX.Element = (
          <VStack spacing={8} alignment="leading" padding={{ horizontal: 20, top: 8 }}>
          <ScopeTabs value={kind} disabled={busy || moduleBusy || editing !== null} onChanged={(value: ResourceKind): void => switchScope(value, destination)} />
          <HStack>
            <Picker title="位置" pickerStyle="menu" value={destination} disabled={busy || moduleBusy || editing !== null} onChanged={(value: string): void => switchScope(kind, value === "surge" ? "surge" : "local")}>
              <Text tag="local">Scripting 本地</Text>
              <Text tag="surge">Surge 文件夹</Text>
            </Picker>
            <Spacer />
            <Text font="caption" foregroundStyle="secondaryLabel">{destination === "local" ? "无需授权" : managedModules ? "模块页独立校验授权" : directory ? "目录可用" : "目录未就绪"}</Text>
          </HStack>
          </VStack>
  )

  return (
    <NavigationStack>
      <VStack spacing={0} navigationTitle="Surge 整体管理" navigationBarTitleDisplayMode="inline" toolbar={{ topBarTrailing: settingsButton }}>
        {scopeSection}
        <ZStack>
          {/* Lazy first visit, then stable identity. No animation transaction reaches either List. */}
          {modulesVisited && destination === "surge" ? <VStack spacing={0} opacity={managedModules ? 1 : 0} allowsHitTesting={managedModules} accessibilityHidden={!managedModules}>
            <HomeView key={`modules-${revision}`} onBusyChanged={setModuleBusy} />
          </VStack> : null}
        <List listStyle="insetGroup" opacity={managedModules ? 0 : 1} allowsHitTesting={!managedModules} accessibilityHidden={managedModules}>
          <Section>
            <HStack spacing={12}>
              <ActionTileButton title="添加" systemImage="plus.square.on.square" tint="systemBlue" disabled={blocked || !directory} onPress={(): Promise<void> => perform((): Promise<void> => download())} />
              <ActionTileButton title="更新" systemImage="arrow.triangle.2.circlepath.circle.fill" tint="systemGreen" disabled={blocked || !directory || !visible.some((file: ResourceFile): boolean => !!file.link.trim())} onPress={(): Promise<void> => perform(updateVisible)} />
            </HStack>
            <TextField title="搜索" value={query} onChanged={(value: string): void => setQuery(value)} prompt="搜索 · 按文件名筛选" frame={{ maxWidth: "infinity", minHeight: 44 }} />
            <HStack spacing={8}>
              <Text font="caption" foregroundStyle="secondaryLabel" fixedSize={{ horizontal: false, vertical: true }}>{status}</Text>
              <Spacer />
              {busy || loading ? <ProgressView /> : null}
              <Button title="刷新" buttonStyle="bordered" font="caption" fixedSize={true} disabled={blocked} action={(): void => { void perform(refresh) }} />
            </HStack>
            {batchProgress ? <BatchProgress snapshot={batchProgress} /> : progress !== null ? <ProgressView value={progress} total={1} progressViewStyle="linear" /> : null}
          </Section>
          <Section header={<Text>{`${label}文件 · ${visible.length}/${files.length}`}</Text>}>
            {!loading && visible.length === 0 ? <Text foregroundStyle="secondaryLabel">{directory ? "暂无匹配文件" : "右上角设置授权目录，或切换到本地"}</Text> : null}
            {visible.map((file: ResourceFile) => (
              <VStack key={file.path} alignment="leading" spacing={6} transition={Transition.opacity()}
                leadingSwipeActions={{ allowsFullSwipe: false, actions: [
                  <Button title="编辑" tint="systemOrange" disabled={blocked} action={(): void => { void perform((): Promise<void> => editContent(file)) }} />,
                ] }}
                trailingSwipeActions={{ allowsFullSwipe: false, actions: [
                  <Button title="更新" tint={file.link.trim() ? "systemGreen" : "systemGray"} disabled={blocked || !file.link.trim()} action={(): void => { void perform((): Promise<void> => download(file)) }} />,
                ] }}
              >
                <Text font="headline">{file.name}</Text>
                <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{file.link || "无来源 · 无法更新"}</Text>
                <HStack spacing={16} buttonStyle="borderless">
                  <Button title={expanded === file.path ? "收起" : "内容"} disabled={blocked} action={(): void => { void perform((): Promise<void> => showContent(file)) }} />
                  <Spacer />
                  <Button title="删除" role="destructive" disabled={blocked} action={(): void => { void perform(async (): Promise<void> => { if (await deleteResource(file)) { setExpanded(""); await refresh() } }) }} />
                </HStack>
                {kind === "module" && editing?.file.path === file.path ? <VStack alignment="leading" spacing={8} transition={Transition.opacity()}>
                  <Text font="caption" foregroundStyle="secondaryLabel">原文编辑 · 保存将覆盖文件内容</Text>
                  <TextField title="文件原文" axis="vertical" lineLimit={{ min: 6, max: 16 }} value={draft} disabled={busy} onChanged={(value: string): void => setDraft(value)} />
                  <HStack spacing={12} buttonStyle="bordered">
                    <Button title="保存" disabled={busy || draft === editing.original} action={(): void => { void perform(saveContent) }} />
                    <Button title="取消" disabled={busy} action={(): void => { void perform(cancelEdit) }} />
                  </HStack>
                </VStack> : null}
                {expanded === file.path ? <VStack alignment="leading" spacing={4} transition={Transition.opacity()}>
                  <Text font="caption" textSelection={true}>{content.slice(0, 4000) || "（空文件）"}</Text>
                  {content.length > 4000 ? <Button title="查看完整内容" action={(): void => { void Navigation.present({ element: <NavigationStack><List navigationTitle={file.name}><Text textSelection={true}>{content}</Text></List></NavigationStack> }) }} /> : null}
                </VStack> : null}
              </VStack>
            ))}
          </Section>
        </List>
        </ZStack>
      </VStack>
    </NavigationStack>
  )
}

export default OverallView
