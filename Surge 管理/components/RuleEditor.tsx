import { Button, Navigation, NavigationStack, Text, TextField, VStack, useRef, useState } from "scripting"

export type RuleEditorProps = {
  name: string
  original: string
  save: (text: string) => Promise<boolean>
}

export function RuleEditor({ name, original, save }: RuleEditorProps) {
  const dismiss: (result?: boolean) => void = Navigation.useDismiss()
  const [draft, setDraft] = useState<string>(original)
  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState<string>("")
  const lock: { current: boolean } = useRef<boolean>(false)

  async function act(saving: boolean): Promise<void> {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError("")
    try {
      if (saving) {
        // A rejected write or a cancelled confirmation never discards the draft.
        if (await save(draft)) dismiss(true)
      } else if (draft === original || await Dialog.confirm({
        title: "放弃修改",
        message: "未保存的分流修改将丢失。确定退出？",
        confirmLabel: "放弃修改",
        cancelLabel: "继续编辑",
      })) {
        dismiss(false)
      }
    } catch (failure: unknown) {
      setError(String(failure instanceof Error ? failure.message : failure))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  return <NavigationStack>
    <VStack spacing={12} padding={16} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
      navigationTitle={name} navigationBarTitleDisplayMode="inline"
      interactiveDismissDisabled={true}
      toolbar={{
        topBarLeading: <Button title="取消" tint="systemBlue" foregroundStyle="systemBlue" disabled={busy} action={(): void => { void act(false) }} />,
        topBarTrailing: <Button title={busy ? "处理中…" : "保存"} tint="systemBlue" foregroundStyle={busy || draft === original ? "secondaryLabel" : "systemBlue"} disabled={busy || draft === original} action={(): void => { void act(true) }} />,
      }}>
      <Text font="caption" foregroundStyle="secondaryLabel">分流全文编辑 · 保存前确认覆盖 · 退出请点取消</Text>
      {error ? <Text foregroundStyle="systemRed" textSelection={true}>{`未完成，草稿已保留：${error}`}</Text> : null}
      <TextField title="分流文件全文" axis="vertical" value={draft}
        lineLimit={{ min: 18, max: 30 }} disabled={busy}
        frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
        onChanged={(value: string): void => setDraft(value)} />
    </VStack>
  </NavigationStack>
}

export default RuleEditor
