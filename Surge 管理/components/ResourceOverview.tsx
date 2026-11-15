import { Button, HStack, Image, ProgressView, RoundedRectangle, Spacer, Text, VStack, ZStack, type Color } from "scripting"
import { motionEnabled, supportsGlass, playFeedback } from "../utils/motion"

type Props = {
  count: number
  total: number
  title: string
  detail: string
  status: string
  connection: string
  available: boolean
  working: boolean
  accent: Color
  refreshDisabled: boolean
  onRefresh: () => void | Promise<void>
  children?: JSX.Element | (JSX.Element | null)[]
}

export function ResourceOverview(props: Props): JSX.Element {
  const animated = motionEnabled()
  return <VStack alignment="leading" spacing={12} padding={16}
    background={<ZStack allowsHitTesting={false} accessibilityHidden>
      <RoundedRectangle cornerRadius={24} fill="secondarySystemGroupedBackground" />
      <RoundedRectangle cornerRadius={24}
        fill={{ colors: [props.accent, "clear"], center: "topLeading", startRadius: 0, endRadius: 280 }} opacity={0.12} />
      <RoundedRectangle cornerRadius={24} fill="clear"
        stroke={{ shapeStyle: { colors: [props.accent, "clear"], startPoint: "topLeading", endPoint: "bottomTrailing" }, strokeStyle: { lineWidth: 0.6 } }} opacity={0.3} />
    </ZStack>}>
    <HStack alignment="top" spacing={12}>
      <VStack alignment="leading" spacing={5}>
        <Text font="caption" fontWeight="semibold" foregroundStyle="secondaryLabel">{props.title}</Text>
        <HStack alignment="firstTextBaseline" spacing={8}>
          <Text font={36} fontWeight="semibold" fontDesign="rounded" monospacedDigit
            contentTransition={animated ? "numericText" : "identity"}
            animation={animated ? { animation: Animation.smooth({ duration: 0.24 }), value: props.count } : undefined}>{String(props.count).padStart(2, "0")}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">{props.count === props.total ? "项资源" : `/ ${props.total} 项`}</Text>
        </HStack>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>{props.detail}</Text>
      </VStack>
      <Spacer minLength={0} />
      <VStack alignment="trailing" spacing={12}>
        <HStack spacing={5} foregroundStyle={props.available ? props.accent : "secondaryLabel"}>
          <Image systemName={props.available ? "checkmark.circle.fill" : "minus.circle"} font={11}
            contentTransition={animated ? "symbolEffectReplace" : "identity"} />
          <Text font="caption2" fontWeight="medium" lineLimit={2}>{props.connection}</Text>
        </HStack>
        <Button buttonStyle={supportsGlass ? "glass" : "bordered"} disabled={props.refreshDisabled}
          background={{ style: "quaternarySystemFill", shape: "circle" }}
          accessibilityLabel="刷新资源并检查来源更新" action={(): void => { if (!props.refreshDisabled) { playFeedback(() => HapticFeedback.softImpact()); void props.onRefresh() } }}>
          <Image systemName="arrow.clockwise" font={16} frame={{ width: 36, height: 36 }} />
        </Button>
      </VStack>
    </HStack>
    {props.children}
    <HStack spacing={7}>
      {props.working ? <ProgressView frame={{ width: 14, height: 14 }} /> : <Image systemName="circle.fill" font={5} foregroundStyle="tertiaryLabel" />}
      <Text font="caption2" foregroundStyle="secondaryLabel" fixedSize={{ horizontal: false, vertical: true }}
        contentTransition={animated && !props.working ? "opacity" : "identity"}>{props.status}</Text>
    </HStack>
  </VStack>
}
