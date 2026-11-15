import { HStack, Image, Spacer, Text, VStack } from "scripting"
import { motionEnabled } from "../utils/motion"

type Props = { title: string; count: number; updates: number; pending: number; expanded: boolean; searching: boolean }

export function CategoryLabel(props: Props): JSX.Element {
  const animated = motionEnabled()
  return <HStack spacing={12} padding={{ vertical: 7 }}>
    <Image systemName={props.expanded ? "square.stack.3d.up.fill" : "square.stack.3d.up"}
      font={20} foregroundStyle="systemTeal" frame={{ width: 40, height: 40 }}
      background={{ style: "quaternarySystemFill", shape: { type: "rect", cornerRadius: 12 } }}
      contentTransition={animated ? "symbolEffectReplace" : "identity"} />
    <VStack alignment="leading" spacing={4}>
      <Text font="headline" foregroundStyle="label">{props.title}</Text>
      <Text font="caption2" foregroundStyle="secondaryLabel">{props.searching ? "搜索命中 · 已展开" : props.expanded ? "再次轻点收起" : `${props.updates} 个有更新${props.pending ? ` · ${props.pending} 个待检查` : ""}`}</Text>
    </VStack>
    <Spacer minLength={4} />
    <Text font={15} fontWeight="medium" monospacedDigit foregroundStyle={props.expanded ? "systemTeal" : "secondaryLabel"}
      padding={{ horizontal: 10, vertical: 6 }}
      background={{ style: "quaternarySystemFill", shape: "capsule" }}
      contentTransition={animated ? "numericText" : "identity"}>{String(props.count).padStart(2, "0")}</Text>
  </HStack>
}
