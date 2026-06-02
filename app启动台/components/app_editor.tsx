import {
  Button,
  Color,
  ColorPicker,
  Form,
  HStack,
  Image,
  Navigation,
  Picker,
  Section,
  Text,
  TextField,
  VStack,
  ZStack,
  useState
} from 'scripting'
import { AppItem, IconType } from '../constants'

interface AppEditorProps {
  item?: AppItem
  onSave: (item: AppItem) => void
}

/**
 * Form for editing app configuration
 */
export function AppEditor({ item, onSave }: AppEditorProps) {
  const [name, setName] = useState(item?.name ?? '')
  const [url, setUrl] = useState(item?.url ?? '')
  const [bundleId, setBundleId] = useState(item?.bundleId ?? '')
  const [icon, setIcon] = useState(item?.icon ?? 'app')
  const [iconType, setIconType] = useState<IconType>(item?.iconType ?? 'symbol')
  const [color, setColor] = useState<Color>((item?.color ?? '#007AFF') as Color)
  const [category, setCategory] = useState(item?.category ?? '')
  const dismiss = Navigation.useDismiss()

  const handleSave = (): void => {
    onSave({
      id: item?.id ?? generateId(),
      name,
      url,
      bundleId: bundleId || undefined,
      icon,
      iconType,
      color: color as unknown as string,
      category
    })
    dismiss()
  }

  return (
    <Form navigationTitle={item ? 'Edit App' : 'Add App'}>
      <Section header={<Text>Basic Info</Text>}>
        <TextField title='Name' value={name} onChanged={setName} />
        <TextField title='URL Scheme' value={url} onChanged={setUrl} />
        <TextField title='Bundle ID' value={bundleId} onChanged={setBundleId} />
        <TextField title='Category' value={category} onChanged={setCategory} />
      </Section>

      <Section header={<Text>Appearance</Text>}>
        <Picker
          title='Icon Type'
          value={iconType}
          onChanged={(v: string) => setIconType(v as IconType)}
        >
          <Text tag='symbol'>SF Symbol</Text>
          <Text tag='image'>Network Image</Text>
        </Picker>

        {iconType === 'symbol' ? (
          <HStack>
            <Text>Icon (SF Symbol)</Text>
            <TextField title='Icon' value={icon} onChanged={setIcon} />
            <Image systemName={icon} font={20} foregroundStyle={color} />
          </HStack>
        ) : (
          <HStack>
            <Text>Image URL</Text>
            <TextField title='URL' value={icon} onChanged={setIcon} />
            <ZStack
              frame={{ width: 20, height: 20 }}
              clipShape={{ type: 'rect', cornerRadius: 4 }}
            >
              <Image imageUrl={icon} resizable scaleToFill />
            </ZStack>
          </HStack>
        )}

        <ColorPicker value={color} onChanged={setColor}>
          <Text>Theme Color</Text>
        </ColorPicker>
      </Section>

      <Section>
        <Button title='Save' action={handleSave} />
      </Section>
    </Form>
  )
}

/**
 * Generate a unique ID for new apps
 */
function generateId(): string {
  return Math.random().toString(36).slice(2)
}