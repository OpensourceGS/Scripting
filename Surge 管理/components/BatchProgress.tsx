import { ProgressView, Text, VStack } from "scripting"
import { type BatchItem, type BatchSnapshot } from "../utils/batch_pool"

function bytes(value: number): string {
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.floor(value / 1024)} KB`
}
export function BatchProgress({ snapshot }: { snapshot: BatchSnapshot }) {
  const active: BatchItem[] = snapshot.items.filter((item: BatchItem): boolean => item.state === "active")
  return <VStack alignment="leading" spacing={6}>
    <Text font="caption">{`进行中 ${snapshot.active} · 已结束 ${snapshot.completed}/${snapshot.total} · 成功 ${snapshot.succeeded} · 失败 ${snapshot.failed} · 跳过 ${snapshot.skipped}`}</Text>
    <ProgressView value={snapshot.fraction} total={1} progressViewStyle="linear"
      frame={{ maxWidth: "infinity" }}
      animation={{ animation: Animation.linear(0.15), value: snapshot.fraction }} />
    <Text font="caption2" foregroundStyle="secondaryLabel">{`队列进度 ${Math.floor(snapshot.fraction * 100)}%（按文件等权估算，含失败）· 已报告 ${bytes(snapshot.received)}${snapshot.unknown ? ` · ${snapshot.unknown} 项总长未知` : ""}`}</Text>
    {active.map((item: BatchItem): JSX.Element => <Text key={item.name} font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>{`${item.name} · ${bytes(item.received)} / ${item.total === undefined ? "未知大小" : bytes(item.total)}`}</Text>)}
  </VStack>
}
