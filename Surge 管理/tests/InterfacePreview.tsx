import { VStack } from "scripting"
import { OverallView } from "../components/OverallView"
import type { ResourceKind } from "../utils/resource_policy"

// 只读初始展示：扫描现有书签、查询远程状态；不自动点击任何业务操作。
export default function InterfacePreview(props: { kind?: ResourceKind; query?: string; light?: boolean }): JSX.Element {
  return <VStack spacing={0} preferredColorScheme={props.light ? "light" : "dark"}>
    <OverallView initialKind={props.kind ?? "module"} initialQuery={props.query ?? ""} />
  </VStack>
}
