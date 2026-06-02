import {
  Button,
  Color,
  EditButton,
  HStack,
  Image,
  List,
  Navigation,
  NavigationLink,
  NavigationStack,
  Script,
  Section,
  Text,
  VStack,
  Widget,
  ZStack,
  useEffect,
  useObservable,
  useState
} from 'scripting'
import { AppItem, DEFAULT_APPS, DEFAULT_CONFIG } from './constants'
import { loadConfig, saveConfig, loadApps, saveApps, cacheAppIcon, performAppUpdateCheck } from './utils'
import { AppEditor } from './components/app_editor'
import { WidgetSettingsSection, ActionsSection } from './components/settings_sections'
import { Config } from './constants'

// =============================================================================
// Custom Hook for Config State
// =============================================================================

function useConfigState() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG)
  const [isLoaded, setIsLoaded] = useState(false)

  const updateConfig = (partial: Partial<Config>): void => {
    const newConfig = { ...config, ...partial }
    setConfig(newConfig)
    saveConfig(newConfig)
  }

  return {
    config,
    setConfig,
    updateConfig,
    isLoaded,
    setIsLoaded
  }
}

// =============================================================================
// Helper Components
// =============================================================================

function AppListItemRow({ item }: { item: AppItem }): JSX.Element {
  return (
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
  )
}

// =============================================================================
// Main Settings Page
// =============================================================================

function AppLauncherSettings() {
  // Use observable for apps list
  const apps = useObservable<AppItem[]>([])
  
  // Config state - simplified from 12 useState calls
  const configState = useConfigState()
  
  const dismiss = Navigation.useDismiss()

  // Load data on mount
  useEffect(() => {
    initializeData()
  }, [])

  // Persist apps when changed
  useEffect(() => {
    if (!configState.isLoaded) return
    saveApps(apps.value)
  }, [apps.value, configState.isLoaded])

  // ===========================================================================
  // Initialization
  // ===========================================================================

  async function initializeData(): Promise<void> {
    try {
      // Load apps
      const savedApps = loadApps()
      apps.setValue(savedApps)
      
      // Load config
      const savedConfig = loadConfig()
      configState.setConfig(savedConfig)
      configState.setIsLoaded(true)
      
      // Cache icons
      savedApps.forEach(cacheAppIcon)
      
      // Check for app updates
      await checkAppUpdates()
    } catch (e) {
      console.error('Failed to initialize data', e)
      apps.setValue(DEFAULT_APPS)
      configState.setConfig(DEFAULT_CONFIG)
      configState.setIsLoaded(true)
    }
  }

  async function checkAppUpdates(): Promise<void> {
    await performAppUpdateCheck()
    // Refresh local state from updated config
    const updatedConfig = loadConfig()
    configState.setConfig(updatedConfig)
  }

  // ===========================================================================
  // App Management
  // ===========================================================================

  function updateApp(item: AppItem): void {
    const currentApps = apps.value
    const index = currentApps.findIndex(a => a.id === item.id)
    
    if (index >= 0) {
      const newApps = [...currentApps]
      newApps[index] = item
      apps.setValue(newApps)
    } else {
      apps.setValue([...currentApps, item])
    }
    
    cacheAppIcon(item)
  }

  function resetToDefaults(): void {
    apps.setValue(DEFAULT_APPS)
    configState.setConfig(DEFAULT_CONFIG)
    saveConfig(DEFAULT_CONFIG)
    console.log('Reset success!')
  }

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <NavigationStack>
      <List
        navigationTitle='Launch'
        toolbar={{
          topBarLeading: [
            <Button title='Close' systemImage='xmark' action={dismiss} />
          ],
          confirmationAction: [
            <EditButton />,
            <NavigationLink
              destination={<AppEditor onSave={updateApp} />}
            >
              <Image systemName='plus' />
            </NavigationLink>
          ]
        }}
      >
        <WidgetSettingsSection
          config={configState.config}
          onUpdateConfig={configState.updateConfig}
          lastUpdateTime={configState.config.lastUpdateTime || ''}
        />

        <Section header={<Text>Apps</Text>}>
          {apps.value.map(item => (
            <NavigationLink
              key={item.id}
              destination={<AppEditor item={item} onSave={updateApp} />}
            >
              <AppListItemRow item={item} />
            </NavigationLink>
          ))}
        </Section>

        <ActionsSection
          onPreview={() => Widget.preview({ family: 'systemMedium' })}
          onReset={resetToDefaults}
        />
      </List>
    </NavigationStack>
  )
}

// =============================================================================
// Entry Point
// =============================================================================

Navigation.present({
  element: <AppLauncherSettings />
}).finally(() => Script.exit())