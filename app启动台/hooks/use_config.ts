import { useState, useEffect, useObservable } from 'scripting'
import { Config, DEFAULT_CONFIG, AppItem, DEFAULT_APPS } from '../constants'
import { loadConfig, saveConfig, loadApps, saveApps, cacheAppIcon } from '../utils'

/**
 * Custom hook for managing configuration state
 * Provides reactive config state with persistence
 */
export function useConfigStore() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    const loaded = loadConfig()
    setConfig(loaded)
    setIsLoaded(true)
  }, [])

  const updateConfig = (partial: Partial<Config>): void => {
    const newConfig = { ...config, ...partial }
    setConfig(newConfig)
    saveConfig(newConfig)
  }

  return {
    config,
    setConfig,
    updateConfig,
    isLoaded
  }
}

/**
 * Custom hook for managing apps state
 */
export function useAppsStore() {
  const apps = useObservable<AppItem[]>([])
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    const loaded = loadApps()
    apps.setValue(loaded)
    setIsLoaded(true)
    // Cache icons on load
    loaded.forEach(cacheAppIcon)
  }, [])

  const updateApps = (newApps: AppItem[]): void => {
    apps.setValue(newApps)
    saveApps(newApps)
  }

  const addApp = (app: AppItem): void => {
    const newApps = [...apps.value, app]
    apps.setValue(newApps)
    saveApps(newApps)
    cacheAppIcon(app)
  }

  const updateApp = (app: AppItem): void => {
    const currentApps = apps.value
    const index = currentApps.findIndex(a => a.id === app.id)
    if (index >= 0) {
      const newApps = [...currentApps]
      newApps[index] = app
      apps.setValue(newApps)
      saveApps(newApps)
    } else {
      addApp(app)
    }
  }

  const removeApp = (id: string): void => {
    const newApps = apps.value.filter(a => a.id !== id)
    apps.setValue(newApps)
    saveApps(newApps)
  }

  const resetApps = (): void => {
    apps.setValue(DEFAULT_APPS)
    saveApps(DEFAULT_APPS)
  }

  return {
    apps,
    updateApps,
    addApp,
    updateApp,
    removeApp,
    resetApps,
    isLoaded
  }
}