import {
  Button,
  Color,
  HStack,
  Image,
  Picker,
  Section,
  Spacer,
  Stepper,
  Text,
  TextField,
  Toggle,
  VStack,
  Widget,
  ZStack,
  useState
} from 'scripting'
import { Config, IconShape, BASE_PATH } from '../constants'

interface SettingsSectionProps {
  config: Config
  onUpdateConfig: (partial: Partial<Config>) => void
  lastUpdateTime: string
}

const BACKGROUND_IMAGE_NAME = 'widget_background'

/**
 * Widget settings section
 */
export function WidgetSettingsSection({ config, onUpdateConfig, lastUpdateTime }: SettingsSectionProps) {
  const [isPickingImage, setIsPickingImage] = useState(false)

  const updateShape = (value: string): void => {
    onUpdateConfig({ shape: value as IconShape })
  }

  const updateIconSize = (delta: number): void => {
    const newSize = config.iconSize + delta
    if (newSize >= 20 && newSize <= 100) {
      onUpdateConfig({ iconSize: newSize })
    }
  }

  const updateSpacing = (delta: number): void => {
    const newSpacing = config.spacing + delta
    if (newSpacing >= 0 && newSpacing <= 50) {
      onUpdateConfig({ spacing: newSpacing })
    }
  }

  const updateRefreshInterval = (delta: number): void => {
    const newInterval = (config.refreshInterval || 240) + delta
    if (newInterval >= 5) {
      onUpdateConfig({ refreshInterval: newInterval })
    }
  }

  const pickBackgroundImage = async (): Promise<void> => {
      if (isPickingImage) return
      
      setIsPickingImage(true)
      try {
        const results = await Photos.pick({ limit: 1 })
        if (results && results.length > 0) {
          const result = results[0]
          const image = await result.uiImage()
          if (image) {
            // Ensure directory exists
            if (!FileManager.existsSync(BASE_PATH)) {
              FileManager.createDirectorySync(BASE_PATH)
            }
            
            // Save the image as JPEG
            const imagePath = `${BASE_PATH}/${BACKGROUND_IMAGE_NAME}.jpg`
            const data = Data.fromJPEG(image, 0.9)
            if (data) {
              FileManager.writeAsDataSync(imagePath, data)
              onUpdateConfig({ backgroundImagePath: imagePath })
            }
          }
        }
      } catch (e) {
        console.error('Failed to pick background image', e)
      } finally {
        setIsPickingImage(false)
      }
    }

  const clearBackgroundImage = (): void => {
    const imagePath = config.backgroundImagePath
    if (imagePath && FileManager.existsSync(imagePath)) {
      FileManager.removeSync(imagePath)
    }
    onUpdateConfig({ backgroundImagePath: '' })
  }

  const hasBackgroundImage = !!config.backgroundImagePath && FileManager.existsSync(config.backgroundImagePath)

  return (
    <Section header={<Text>Settings</Text>}>
      <Picker
        title='Icon Shape'
        value={config.shape}
        onChanged={updateShape}
      >
        <Text tag='rounded'>Rounded Rectangle</Text>
        <Text tag='circle'>Circle</Text>
      </Picker>

      <TextField
        title='iTunes IDs'
        value={config.itunesIds || ''}
        onChanged={(v: string) => onUpdateConfig({ itunesIds: v })}
      />
      <Text font={10} opacity={0.5} padding={{ leading: 16, bottom: 8 }}>
        Comma separated IDs for monitoring app updates. {lastUpdateTime ? `Last updated: ${lastUpdateTime}` : ''}
      </Text>

      <Stepper
        onIncrement={() => updateIconSize(1)}
        onDecrement={() => updateIconSize(-1)}
      >
        <HStack>
          <Text>Icon Size</Text>
          <Spacer />
          <Text opacity={0.5}>{config.iconSize.toString()}</Text>
        </HStack>
      </Stepper>

      <Stepper
        onIncrement={() => updateSpacing(1)}
        onDecrement={() => updateSpacing(-1)}
      >
        <HStack>
          <Text>Spacing</Text>
          <Spacer />
          <Text opacity={0.5}>{config.spacing.toString()}</Text>
        </HStack>
      </Stepper>

      <Picker
        title='Icon Rendering Mode'
        value={config.widgetAccentedRenderingMode}
        onChanged={(v: string) => onUpdateConfig({ widgetAccentedRenderingMode: v as Config['widgetAccentedRenderingMode'] })}
      >
        <Text tag='fullColor'>Full Color</Text>
        <Text tag='accented'>Accented</Text>
        <Text tag='desaturated'>Desaturated</Text>
        <Text tag='accentedDesaturated'>Accented & Desaturated</Text>
      </Picker>

      <HStack>
              <Text>Background Image</Text>
              <Spacer />
              {hasBackgroundImage ? (
                <HStack spacing={8}>
                  <Text font={12} opacity={0.6}>Selected</Text>
                  <Button
                    title="Clear"
                    foregroundStyle="red"
                    action={clearBackgroundImage}
                  />
                </HStack>
              ) : (
                <Button
                  title={isPickingImage ? 'Picking...' : 'Choose Image'}
                  action={pickBackgroundImage}
                  disabled={isPickingImage}
                />
              )}
            </HStack>
            {hasBackgroundImage && (
              <Text font={10} opacity={0.5} padding={{ top: 4 }}>
                Image will be scaled to fit widget size
              </Text>
            )}

      <Stepper
        onIncrement={() => updateRefreshInterval(15)}
        onDecrement={() => updateRefreshInterval(-15)}
      >
        <HStack>
          <Text>Refresh Interval</Text>
          <Spacer />
          <Text opacity={0.5}>{(config.refreshInterval || 240).toString()} min</Text>
        </HStack>
      </Stepper>

      </Section>
  )
}

// =============================================================================
// App List Item Component
// =============================================================================

interface AppListItemData {
  id: string
  name: string
  icon: string
  iconType?: string
  url: string
  color: string
  category?: string
}

interface AppListItemProps {
  item: AppListItemData
  onPress: () => void
}

function AppListItem({ item, onPress }: AppListItemProps) {
  return (
    <Button buttonStyle='plain' action={onPress}>
      <HStack>
        {item.iconType === 'image' ? (
          <ZStack
            frame={{ width: 24, height: 24 }}
            clipShape={{ type: 'rect', cornerRadius: 6 }}
          >
            <Image imageUrl={item.icon} resizable scaleToFill />
          </ZStack>
        ) : (
          <Image
            systemName={item.icon}
            foregroundStyle={item.color as Color}
          />
        )}
        <VStack alignment='leading'>
          <HStack>
            <Text font={16}>{item.name}</Text>
            {item.category ? (
              <Text font={10} opacity={0.5} padding={{ leading: 4 }}>
                {item.category}
              </Text>
            ) : null}
          </HStack>
          <Text font={12} opacity={0.6} lineLimit={1}>
            {item.url}
          </Text>
        </VStack>
      </HStack>
    </Button>
  )
}

// =============================================================================
// Apps List Section
// =============================================================================

interface AppsListSectionProps {
  apps: AppListItemData[]
  onEditApp: (item: AppListItemData) => void
}

/**
 * Apps list section with navigation
 */
export function AppsListSection({ apps, onEditApp }: AppsListSectionProps) {
  return (
    <Section header={<Text>Apps</Text>}>
      {apps.map(item => (
        <AppListItem key={item.id} item={item} onPress={() => onEditApp(item)} />
      ))}
    </Section>
  )
}

// =============================================================================
// Actions Section
// =============================================================================

interface ActionsSectionProps {
  onPreview: () => void
  onReset: () => void
}

/**
 * Action buttons section
 */
export function ActionsSection({ onPreview, onReset }: ActionsSectionProps) {
  return (
    <Section>
      <Button title='Preview Widget' action={onPreview} />
      <Button
        title='Reset to Defaults'
        foregroundStyle='red'
        action={onReset}
      />
    </Section>
  )
}