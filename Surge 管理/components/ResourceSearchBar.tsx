import { Button, HStack, Image, RoundedRectangle, Text, TextField, useEffect, useState, type Color } from "scripting"
import { motionEnabled } from "../utils/motion"

type Props = {
  value: string
  onChanged: (value: string) => void
  prompt: string
  accent?: Color
  active?: boolean
}

export function ResourceSearchBar({ value, onChanged, prompt, accent = "systemBlue", active = true }: Props): JSX.Element {
  const [focused, setFocused] = useState<boolean>(false)
  const animate = motionEnabled()
  const canClear = active && value.length > 0
  useEffect((): void => { if (!active) setFocused(false) }, [active])

  return (
    <HStack
      spacing={8}
      padding={{ leading: 14, trailing: 4, vertical: 4 }}
      background={{ style: "secondarySystemGroupedBackground", shape: { type: "rect", cornerRadius: 16 } }}
      overlay={
        <RoundedRectangle
          cornerRadius={16}
          fill="clear"
          stroke={{ shapeStyle: focused ? accent : "separator", strokeStyle: { lineWidth: focused ? 1 : 0.5 } }}
          opacity={focused ? 0.65 : 0.5}
          allowsHitTesting={false}
          accessibilityHidden
        />
      }
      scaleEffect={animate && focused ? 1.006 : 1}
      animation={animate ? {
        animation: Animation.smooth({ duration: 0.22, extraBounce: 0 }),
        value: focused,
      } : undefined}
    >
      <Image
        systemName="magnifyingglass"
        font={17}
        foregroundStyle={focused ? accent : "secondaryLabel"}
        accessibilityHidden
      />
      {active ? <TextField
        title="搜索"
        value={value}
        prompt={prompt}
        onChanged={onChanged}
        textFieldStyle="plain"
        textInputAutocapitalization="never"
        autocorrectionDisabled
        submitLabel="search"
        tint={accent}
        onFocus={(): void => setFocused(true)}
        onBlur={(): void => setFocused(false)}
        frame={{ maxWidth: "infinity", minHeight: 44 }}
      /> : <Text font="body" foregroundStyle="secondaryLabel" lineLimit={1}
        frame={{ maxWidth: "infinity", minHeight: 44, alignment: "leading" }}>{value || prompt}</Text>}
      {/* Keep the hit target reserved so typing and clearing never shift the field. */}
      <Button
        buttonStyle="plain"
        accessibilityLabel="清空搜索"
        accessibilityHidden={!canClear}
        disabled={!canClear}
        allowsHitTesting={canClear}
        opacity={canClear ? 1 : 0}
        frame={{ width: 44, height: 44 }}
        action={(): void => { if (canClear) onChanged("") }}
      >
        <Image
          systemName="xmark.circle.fill"
          font={17}
          foregroundStyle="secondaryLabel"
          frame={{ width: 44, height: 44 }}
          contentShape="rect"
          accessibilityHidden
        />
      </Button>
    </HStack>
  )
}
