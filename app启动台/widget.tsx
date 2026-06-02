import {
  Color,
  HStack,
  Image,
  Link,
  Spacer,
  VStack,
  ZStack,
  Widget,
  Text,
  Button,
  EnvironmentValuesReader
} from 'scripting'
import {
  AppItem,
  Config,
  WIDGET_STYLES
} from './constants'
import {
  performAppUpdateCheck,
  loadWidgetData,
  WidgetData,
  iconCacheExists
} from './utils'
import { AcknowledgeIntent, RefreshIntent, OpenAppIntent } from './app_intents'
import { getIconCachePath } from './constants'

// =============================================================================
// Widget Sub-components
// =============================================================================

interface AppIconProps {
  item: AppItem
  config: Config
}

/**
 * App icon component for widget display
 * Uses cached icon existence check for better performance
 * 
 * Open mode priority:
 * 1. If bundleId exists → use Widget.openApp via OpenAppIntent
 * 2. Otherwise → use Link with url scheme
 */
function AppIcon({ item, config }: AppIconProps) {
  const size = config.iconSize || 50
  const radius = config.shape === 'circle' ? size / 2 : size * 0.225
  const cachePath = getIconCachePath(item.icon)
  
  // Use cached existence check instead of sync file system call
  const imageExists = item.iconType === 'image' && !!cachePath && iconCacheExists(item.icon)
  const renderingMode = config.widgetAccentedRenderingMode || 'fullColor'

  // Icon content (shared between both modes)
  const iconContent = (
    <ZStack
      frame={{ width: size, height: size }}
      clipShape={{ type: 'rect', cornerRadius: radius }}
    >
      {/* Background placeholder */}
      {!imageExists && (
        <Image
          systemName="square.fill"
          foregroundStyle={(item.color || '#8E8E93') as Color}
          resizable
          frame={{ width: size, height: size }}
          widgetAccentable={false}
        />
      )}

      {/* Cached image or fallback icon */}
      {imageExists ? (
        <Image
          filePath={cachePath}
          resizable
          scaleToFill
          frame={{ width: size, height: size }}
          widgetAccentedRenderingMode={renderingMode}
        />
      ) : (
        <Image
          systemName={item.iconType === 'image' ? 'app' : (item.icon || 'app')}
          foregroundStyle='white'
          font={size * 0.5}
          widgetAccentable={false}
        />
      )}
    </ZStack>
  )

  // Use OpenAppIntent if bundleId is available (preferred)
  if (item.bundleId) {
    return (
      <Button
        intent={OpenAppIntent(item.bundleId)}
        buttonStyle='plain'
      >
        {iconContent}
      </Button>
    )
  }

  // Fallback to Link with url scheme
  return (
    <Link url={item.url} buttonStyle='plain'>
      {iconContent}
    </Link>
  )
}

interface HeaderProps {
  config: Config
  runTime: string
}

/**
 * Widget header with update status and refresh button
 */
function WidgetHeader({ config, runTime }: HeaderProps) {
  const { colors, fonts, spacing, headerOffset, badge } = WIDGET_STYLES

  const idsRaw = config.itunesIds || ''
  const monitoredCount = idsRaw.split(',').map(id => id.trim()).filter(id => id.length > 0).length
  const updateCount = config.updateCount || 0
  const updateNames = config.updateNames || ''

  const statusText = monitoredCount === 0
    ? '未设置监控 ID 🔍'
    : updateCount > 0
      ? `${updateNames.split(',')[0]} 等有更新 ✨`
      : `已监控 ${monitoredCount} 个应用 ☕️`

  const timeDisplay = config.lastUpdateTime === runTime
    ? runTime
    : `${runTime} ·缓存`

  return (
    <HStack spacing={8} alignment='center' frame={{ height: spacing.headerHeight }} offset={headerOffset}>
      {/* Apps Badge */}
      <Link url="itms-apps://itunes.apple.com/updates" buttonStyle='plain'>
        <ZStack alignment='center' frame={{ width: badge.width, height: badge.height }}>
          <Image
            systemName="square.fill"
            foregroundStyle="#000000"
            resizable
            frame={{ width: badge.width, height: badge.height }}
            clipShape={{ type: 'rect', cornerRadius: badge.cornerRadius }}
            widgetAccentedRenderingMode="fullColor"
          />
          <Text
            font={fonts.badge}
            foregroundStyle='white'
            fontWeight="bold"
            widgetAccentable={false}
          >
            APPS
          </Text>
        </ZStack>
      </Link>

      {/* Status Text */}
      <Button intent={AcknowledgeIntent(undefined)} buttonStyle='plain'>
        <Text
          font={fonts.subtitle}
          foregroundStyle={colors.textSecondary as Color}
          lineLimit={1}
          widgetAccentable={false}
        >
          {statusText}
        </Text>
      </Button>

      <Spacer />

      {/* Time / Refresh */}
      {config.lastUpdateTime ? (
        <Button intent={RefreshIntent(undefined)} buttonStyle='plain'>
          <Text
            font={9}
            foregroundStyle={colors.textSecondary as Color}
            opacity={0.6}
            widgetAccentable={false}
          >
            {timeDisplay}
          </Text>
        </Button>
      ) : (
        <Spacer frame={{ width: 1, height: 1 }} />
      )}
    </HStack>
  )
}

interface AppGroupProps {
  name: string
  items: AppItem[]
  config: Config
  colorScheme?: 'light' | 'dark'
}

/**
 * A group of apps with category label
 */
function AppGroup({ name, items, config, colorScheme = 'light' }: AppGroupProps) {
  const { colors, fonts, spacing } = WIDGET_STYLES
  const itemSpacing = spacing.itemSpacing
  const textColor = colorScheme === 'dark' ? colors.textPrimaryDark : colors.textPrimaryLight

  return (
    <VStack alignment='leading' spacing={2}>
      <Text
        font={fonts.category}
        foregroundStyle={textColor as Color}
        opacity={0.8}
        widgetAccentable={false}
      >
        {name}
      </Text>
      <HStack spacing={itemSpacing}>
        {items.map(item => (
          <AppIcon key={item.id} item={item} config={config} />
        ))}
      </HStack>
    </VStack>
  )
}

// =============================================================================
// Widget Views
// =============================================================================

interface MediumWidgetProps {
  data: WidgetData
  colorScheme?: 'light' | 'dark'
}

/**
 * Medium widget layout with grouped apps
 */
function MediumWidget({ data, colorScheme = 'light' }: MediumWidgetProps) {
  const { apps, config, runTime } = data
  const { spacing, contentOffset } = WIDGET_STYLES

  const iconSize = config.iconSize || 50
  // 按照0.75缩放以适应中号布局
  const effectiveIconSize = iconSize * 0.75

  // Build groups from apps
  const categories = Array.from(new Set(apps.map(a => a.category || 'Other')))
  const groups = categories
    .slice(0, 4)
    .map(cat => ({
      name: cat,
      items: apps
        .filter(a => (a.category || 'Other') === cat)
        .slice(0, 4)
    }))
    .filter(g => g.items.length > 0)

  return (
    <VStack
      spacing={0}
      alignment='leading'
      padding={16}
      frame={{
        width: Widget.displaySize.width,
        height: Widget.displaySize.height
      }}
    >
      <WidgetHeader config={config} runTime={runTime} />

      <VStack spacing={spacing.groupSpacing} offset={contentOffset}>
        {[0, 2].map(baseIdx => {
          const groupA = groups[baseIdx]
          const groupB = groups[baseIdx + 1]

          if (!groupA) {
            return <Spacer key={baseIdx} frame={{ height: 0 }} />
          }

          return (
            <HStack
              key={baseIdx}
              spacing={0}
              alignment='top'
              frame={{ width: Widget.displaySize.width - 32 }}
            >
              <AppGroup
                name={groupA.name}
                items={groupA.items}
                config={{ ...config, iconSize: effectiveIconSize }}
                colorScheme={colorScheme}
              />
              <Spacer />
              {groupB && (
                <AppGroup
                  name={groupB.name}
                  items={groupB.items}
                  config={{ ...config, iconSize: effectiveIconSize }}
                  colorScheme={colorScheme}
                />
              )}
            </HStack>
          )
        })}
      </VStack>
    </VStack>
  )
}

interface SmallWidgetProps {
  data: WidgetData
}

/**
 * Small widget layout with grid of apps
 */
function SmallWidget({ data }: SmallWidgetProps) {
  const { apps, config } = data
  const iconSize = config.iconSize || 50
  const displayApps = apps.slice(0, 8)
  
  const totalWidth = Widget.displaySize.width
  const cols = Math.max(1, Math.floor((totalWidth - 20) / (iconSize + 10)))
  
  const rows: AppItem[][] = []
  for (let i = 0; i < displayApps.length; i += cols) {
    rows.push(displayApps.slice(i, i + cols))
  }

  return (
    <VStack spacing={config.spacing || 15} alignment='center' frame={{
      width: Widget.displaySize.width,
      height: Widget.displaySize.height
    }}>
      {rows.map((row, rIdx) => (
        <HStack key={rIdx} spacing={10}>
          {row.map(item => (
            <AppIcon key={item.id} item={item} config={config} />
          ))}
        </HStack>
      ))}
    </VStack>
  )
}

// =============================================================================
// Main Widget Component
// =============================================================================

interface LauncherWidgetProps {
  runTime: string
}

function LauncherWidget({ runTime }: LauncherWidgetProps) {
  const data = loadWidgetData()
  const isMedium = Widget.displaySize.width > Widget.displaySize.height * 1.5
  
  // Check if background image exists
  const backgroundImagePath = data.config.backgroundImagePath
  const hasBackgroundImage = !!(backgroundImagePath && FileManager.existsSync(backgroundImagePath))

  return (
    <EnvironmentValuesReader keys={["colorScheme", "widgetRenderingMode"]}>
      {(env) => {
        // Determine if we're in tinted/accented mode
        const isTintedMode = env.widgetRenderingMode === "accented"

        return (
          <ZStack alignment="topLeading">
            {/* Background layer - uses widgetBackground for proper tinted mode handling */}
            {!hasBackgroundImage && (
              <ZStack
                frame={{
                  width: Widget.displaySize.width,
                  height: Widget.displaySize.height
                }}
                widgetBackground={{
                  light: "systemGray6",
                  dark: "systemGray6"
                }}
              />
            )}

            {/* Background image layer */}
            {hasBackgroundImage && (
              <Image
                filePath={backgroundImagePath}
                resizable
                scaleToFill
                frame={{
                  width: Widget.displaySize.width,
                  height: Widget.displaySize.height
                }}
              />
            )}

            {/* Content layer */}
            <ZStack
              alignment="topLeading"
              frame={{
                width: Widget.displaySize.width,
                height: Widget.displaySize.height
              }}
            >
              {isMedium ? (
                <MediumWidget data={data} colorScheme={env.colorScheme} />
              ) : (
                <SmallWidget data={data} />
              )}
            </ZStack>
          </ZStack>
        )
      }}
    </EnvironmentValuesReader>
  )
}

// =============================================================================
// Widget Entry Point
// =============================================================================

async function render() {
  // Trigger update check in background before loading state
  // It has its own 5-min internal cooldown to avoid redundant network hits
  await performAppUpdateCheck()

  const now = new Date()
  const runTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`

  const data = loadWidgetData()
  const refreshInterval = data.config.refreshInterval || 240

  Widget.present(
    <LauncherWidget runTime={runTime} />,
    {
      policy: 'after',
      date: new Date(Date.now() + refreshInterval * 60 * 1000)
    }
  )
}

render()