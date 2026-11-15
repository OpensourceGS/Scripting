import { HStack, Image, Text, type Color } from "scripting"
import { statusLabel, type UpdateStatus } from "../utils/update_check"

export function UpdateBadge({ status }: { status: UpdateStatus }): JSX.Element {
  const color: Color = status.state === "available" ? "systemOrange" : status.state === "current" ? "systemTeal" : "secondaryLabel"
  const icon = status.state === "available" ? "arrow.down.circle.fill" : status.state === "current" ? "checkmark.circle" : status.state === "error" ? "exclamationmark.circle" : status.state === "noSource" ? "link.badge.plus" : "clock"
  const time = status.checkedAt ? new Date(status.checkedAt).toLocaleTimeString() : "尚未完成检查"
  return <HStack spacing={4} foregroundStyle={color} accessibilityLabel={`${statusLabel(status)}，${time}，${status.detail}`}>
    <Image systemName={icon} font={11} />
    <Text font="caption2">{statusLabel(status)}</Text>
    {status.cached ? <Text font="caption2" foregroundStyle="tertiaryLabel">· 缓存</Text> : null}
  </HStack>
}
