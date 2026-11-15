import { Button, GeometryReader, HStack, Image, Text, ZStack, useRef, type GeometryProxy, type ShapeStyle } from "scripting"
import { supportsGlass, playFeedback } from "../utils/motion"

export function ActionTileButton(props: {
  title: string
  systemImage: string
  disabled?: boolean
  tint?: ShapeStyle
  onPress: () => void | Promise<void>
}): JSX.Element {
  const pending = useRef<boolean>(false)
  const foreground: ShapeStyle = props.disabled ? "secondaryLabel" : (props.tint ?? "systemBlue")

  async function handlePress(): Promise<void> {
    if (props.disabled || pending.current) return
    pending.current = true
    try {
      const operation = props.onPress()
      // Feedback acknowledges an accepted press, never the operation's outcome.
      playFeedback(() => HapticFeedback.softImpact())
      await operation
    } finally {
      pending.current = false
    }
  }

  return (
    <ZStack frame={{ maxWidth: "infinity", height: 50 }}>
    <GeometryReader>
      {(geometry: GeometryProxy): JSX.Element => {
        const width: number = Math.max(0, geometry.size.width)
        return (
          <Button
            action={handlePress}
            disabled={props.disabled}
            buttonStyle={supportsGlass ? "glass" : "bordered"}
            buttonBorderShape={{ roundedRectangleRadius: 14 }}
            controlSize="regular"
            tint="secondaryLabel"
            accessibilityLabel={props.title}
            frame={{ width, height: 50 }}
            background={{ style: "tertiarySystemFill", shape: { type: "rect", cornerRadius: 15 } }}
          >
            <HStack spacing={8} frame={{ width: Math.max(0, width - 24), height: 36 }}>
              <Image
                systemName={props.systemImage}
                font={18}
                foregroundStyle={foreground}
                accessibilityHidden
              />
              <Text font="headline" lineLimit={1} minScaleFactor={0.85} foregroundStyle={props.disabled ? "secondaryLabel" : "label"}>
                {props.title}
              </Text>
            </HStack>
          </Button>
        )
      }}
    </GeometryReader>
    </ZStack>
  )
}
