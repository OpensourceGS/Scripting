import { Button, GeometryReader, HStack, Image, RoundedRectangle, Text, ZStack, type GeometryProxy } from "scripting"
import type { ResourceKind } from "../utils/resource_policy"

type Tab = { value: ResourceKind; title: string; icon: string }
const tabs: Tab[] = [
  { value: "module", title: "模块", icon: "square.stack.3d.up" },
  { value: "rule", title: "分流", icon: "arrow.triangle.branch" },
]
type Props = { value: ResourceKind; disabled: boolean; onChanged: (value: ResourceKind) => void }

// Click-only adaptation of LiquidDock.tsx:90-103. One persistent lens and
// highlighted glyph mask share geometry. No frame clock or business animation.
export function ScopeTabs({ value, disabled, onChanged }: Props): JSX.Element {
  return <ZStack frame={{ height: 64 }}><GeometryReader>{(geometry: GeometryProxy): JSX.Element => {
    const width: number = Math.max(106, geometry.size.width)
    const item: number = (width - 18) / 2
    const x: number = 6 + (value === "rule" ? item + 6 : 0)
    const glyphs: (highlighted: boolean) => JSX.Element = (highlighted: boolean): JSX.Element => (
      <ZStack alignment="leading" frame={{ width, height: 64, alignment: "leading" }}>
        {tabs.map((tab: Tab, index: number): JSX.Element => <HStack key={tab.value} spacing={7}
          frame={{ width: item, height: 52 }} offset={{ x: 6 + index * (item + 6), y: 0 }}
          foregroundStyle={highlighted ? "systemBlue" : "secondaryLabel"}>
          <Image systemName={tab.icon} font={22} />
          <Text font="headline">{tab.title}</Text>
        </HStack>)}
      </ZStack>
    )
    return <ZStack alignment="leading" frame={{ width, height: 64, alignment: "leading" }}>
      <RoundedRectangle cornerRadius={32} fill="tertiarySystemFill" allowsHitTesting={false} />
      <ZStack allowsHitTesting={false} accessibilityHidden>
        {glyphs(false)}
        <ZStack alignment="leading" frame={{ width, height: 64, alignment: "leading" }}
          animation={{ animation: Animation.smooth({ duration: 0.4, extraBounce: 0 }), value }}>
          <RoundedRectangle cornerRadius={26} fill="secondarySystemGroupedBackground"
            frame={{ width: item, height: 52 }} offset={{ x, y: 0 }} />
          <ZStack frame={{ width, height: 64, alignment: "leading" }} mask={{ alignment: "leading", content:
            <RoundedRectangle cornerRadius={26} fill="white" frame={{ width: item, height: 52 }} offset={{ x, y: 0 }} /> }}>
            {glyphs(true)}
          </ZStack>
        </ZStack>
      </ZStack>
      {tabs.map((tab: Tab, index: number): JSX.Element => <Button key={tab.value} buttonStyle="plain"
        disabled={disabled} accessibilityLabel={tab.title} accessibilityAddTraits={value === tab.value ? "isSelected" : undefined}
        action={(): void => { if (!disabled && value !== tab.value) onChanged(tab.value) }}
        frame={{ width: item, height: 52 }} offset={{ x: 6 + index * (item + 6), y: 0 }}>
        <RoundedRectangle cornerRadius={26} fill="clear" contentShape="capsule" frame={{ width: item, height: 52 }} />
      </Button>)}
    </ZStack>
  }}</GeometryReader></ZStack>
}
