import { fetch, Widget } from 'scripting'
import {
  Config,
  CONFIG_PATH,
  DEFAULT_CONFIG,
  BASE_PATH,
  CACHE_PATH,
  AppItem,
  FILE_PATH,
  DEFAULT_APPS,
  getIconCachePath,
  normalizeGithubUrl,
  UPDATE_CHECK_COOLDOWN,
  ITUNES_API_BASE
} from './constants'

// =============================================================================
// Performance: In-Memory Cache
// =============================================================================

/** Memory cache for config to avoid repeated file reads */
let _configCache: Config | null = null
let _configCacheTime: number = 0
const CONFIG_CACHE_TTL = 5000 // 5 seconds

/** Memory cache for apps to avoid repeated file reads */
let _appsCache: AppItem[] | null = null
let _appsCacheTime: number = 0
const APPS_CACHE_TTL = 5000 // 5 seconds

/** Memory cache for icon existence checks */
const _iconExistsCache = new Map<string, boolean>()

/** Memory cache for iTunes API responses */
let _itunesCache: { ids: string; response: ITunesResponse; time: number } | null = null
const ITUNES_CACHE_TTL = 60 * 1000 // 1 minute

// =============================================================================
// File System Utilities
// =============================================================================

/**
 * Ensure the base directory exists
 */
export function ensureBaseDirectory(): void {
  if (!FileManager.existsSync(BASE_PATH)) {
    FileManager.createDirectory(BASE_PATH)
  }
}

/**
 * Ensure the cache directory exists
 */
export function ensureCacheDirectory(): void {
  if (!FileManager.existsSync(CACHE_PATH)) {
    FileManager.createDirectorySync(CACHE_PATH, true)
  }
}

// =============================================================================
// Config Management (with caching)
// =============================================================================

/**
 * Load config from file system with memory caching
 */
export function loadConfig(): Config {
  const now = Date.now()
  
  // Return cached config if still valid
  if (_configCache && (now - _configCacheTime < CONFIG_CACHE_TTL)) {
    return { ..._configCache }
  }

  try {
    if (FileManager.existsSync(CONFIG_PATH)) {
      const content = FileManager.readAsStringSync(CONFIG_PATH)
      const saved = JSON.parse(content) as Partial<Config>
      _configCache = { ...DEFAULT_CONFIG, ...saved }
      _configCacheTime = now
      return { ..._configCache }
    }
  } catch (e) {
    console.error('Failed to load config', e)
  }
  
  _configCache = { ...DEFAULT_CONFIG }
  _configCacheTime = now
  return { ..._configCache }
}

/**
 * Save config to file system and invalidate cache
 */
export function saveConfig(config: Config): void {
  ensureBaseDirectory()
  FileManager.writeAsStringSync(CONFIG_PATH, JSON.stringify(config))
  
  // Update cache
  _configCache = { ...config }
  _configCacheTime = Date.now()
  
  Widget.reloadAll()
}

/**
 * Update config with partial values
 */
export function updateConfig(partial: Partial<Config>): Config {
  const current = loadConfig()
  const updated = { ...current, ...partial }
  saveConfig(updated)
  return updated
}

/**
 * Invalidate config cache (call when config might have changed externally)
 */
export function invalidateConfigCache(): void {
  _configCache = null
  _configCacheTime = 0
}

// =============================================================================
// Apps Management (with caching)
// =============================================================================

/**
 * Load apps from file system with memory caching
 */
export function loadApps(): AppItem[] {
  const now = Date.now()
  
  // Return cached apps if still valid
  if (_appsCache && (now - _appsCacheTime < APPS_CACHE_TTL)) {
    return [..._appsCache]
  }

  try {
    if (FileManager.existsSync(FILE_PATH)) {
      const content = FileManager.readAsStringSync(FILE_PATH)
      const saved = JSON.parse(content) as AppItem[]
      if (Array.isArray(saved) && saved.length > 0) {
        _appsCache = saved
        _appsCacheTime = now
        return [...saved]
      }
    }
  } catch (e) {
    console.error('Failed to load apps', e)
  }
  
  _appsCache = [...DEFAULT_APPS]
  _appsCacheTime = now
  return [...DEFAULT_APPS]
}

/**
 * Save apps to file system and invalidate cache
 */
export function saveApps(apps: AppItem[]): void {
  ensureBaseDirectory()
  FileManager.writeAsStringSync(FILE_PATH, JSON.stringify(apps))
  
  // Update cache
  _appsCache = [...apps]
  _appsCacheTime = Date.now()
  
  // Invalidate icon cache since apps might have changed
  _iconExistsCache.clear()
  
  Widget.reloadAll()
}

/**
 * Initialize default apps if not exists
 */
export function initializeDefaultApps(): void {
  if (!FileManager.existsSync(FILE_PATH)) {
    saveApps(DEFAULT_APPS)
  }
}

/**
 * Invalidate apps cache
 */
export function invalidateAppsCache(): void {
  _appsCache = null
  _appsCacheTime = 0
  _iconExistsCache.clear()
}

// =============================================================================
// Icon Cache Management (optimized)
// =============================================================================

/**
 * Check if icon exists in cache (with memory caching)
 */
export function iconCacheExists(iconUrl: string): boolean {
  const cachePath = getIconCachePath(iconUrl)
  if (!cachePath) return false
  
  // Check memory cache first
  if (_iconExistsCache.has(cachePath)) {
    return _iconExistsCache.get(cachePath) ?? false
  }
  
  // Check file system
  const exists = FileManager.existsSync(cachePath)
  _iconExistsCache.set(cachePath, exists)
  return exists
}

/**
 * Cache an app icon from URL (with concurrency control)
 */
export async function cacheAppIcon(item: AppItem): Promise<boolean> {
  if (item.iconType !== 'image' || !item.icon) return false

  const iconUrl = normalizeGithubUrl(item.icon)
  const cachePath = getIconCachePath(iconUrl)

  if (!cachePath) return false
  
  // Already cached
  if (iconCacheExists(iconUrl)) return true

  ensureCacheDirectory()

  try {
    const resp = await fetch(iconUrl)
    if (!resp.ok) {
      console.error(`Failed to download icon: ${iconUrl}, status: ${resp.status}`)
      return false
    }

    const buffer = await resp.arrayBuffer()
    const data = Data.fromArrayBuffer(buffer)

    if (data) {
      FileManager.writeAsDataSync(cachePath, data)
      // Update memory cache
      _iconExistsCache.set(cachePath, true)
      return true
    }
  } catch (e) {
    console.error(`Failed to cache icon: ${iconUrl}`, e)
  }

  return false
}

/**
 * Cache icons for multiple apps with concurrency limit
 */
export async function cacheAppIcons(apps: AppItem[], concurrency: number = 3): Promise<void> {
  const toCache = apps.filter(app => app.iconType === 'image' && app.icon)
  
  // Process in batches to limit concurrency
  for (let i = 0; i < toCache.length; i += concurrency) {
    const batch = toCache.slice(i, i + concurrency)
    await Promise.all(batch.map(app => cacheAppIcon(app)))
  }
  
  Widget.reloadAll()
}

// =============================================================================
// App Update Check (with API response caching)
// =============================================================================

interface ITunesResponse {
  results: Array<{
    trackId: number
    trackName: string
    version: string
  }>
}

interface VersionCache {
  [appId: string]: string
}

/**
 * Get version cache from storage
 */
function getVersionCache(): VersionCache {
  return Storage.get<VersionCache>('update_cache') || {}
}

/**
 * Set version cache to storage
 */
function setVersionCache(cache: VersionCache): void {
  Storage.set('update_cache', cache)
}

/**
 * Fetch app info from iTunes API (with response caching)
 */
async function fetchITunesData(ids: string): Promise<ITunesResponse | null> {
  const now = Date.now()
  
  // Check memory cache
  if (_itunesCache && 
      _itunesCache.ids === ids && 
      (now - _itunesCache.time < ITUNES_CACHE_TTL)) {
    return _itunesCache.response
  }

  const url = `${ITUNES_API_BASE}?id=${ids.replace(/\s+/g, '')}&country=cn&entity=software`

  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const data = await resp.json() as ITunesResponse
    
    // Cache the response
    _itunesCache = { ids, response: data, time: now }
    return data
  } catch (e) {
    console.error('iTunes API request failed', e)
    return null
  }
}

/**
 * Check for app updates
 */
export async function performAppUpdateCheck(): Promise<void> {
  const config = loadConfig()
  const idsString = config.itunesIds || ''

  if (!idsString.trim()) return

  const now = new Date()
  const lastCheck = config.lastCheckTimestamp || 0

  // Check cooldown
  if (lastCheck && (now.getTime() - lastCheck < UPDATE_CHECK_COOLDOWN)) {
    return
  }

  const resp = await fetchITunesData(idsString)
  if (!resp?.results) return

  const currentCache = getVersionCache()
  let updateCount = 0
  const updatedNames: string[] = []
  let cacheChanged = false

  for (const app of resp.results) {
      const id = app.trackId.toString()
      const version = app.version

      if (currentCache[id]) {
        if (currentCache[id] !== version) {
          updateCount++
          updatedNames.push(app.trackName)
          // Update cache to reflect the new version
          currentCache[id] = version
          cacheChanged = true
        }
      } else {
        currentCache[id] = version
        cacheChanged = true
      }
    }

  if (cacheChanged) {
    setVersionCache(currentCache)
  }

  const timeStr = formatTime(now)
  updateConfig({
    updateCount,
    updateNames: updatedNames.slice(0, 3).join(', '),
    lastUpdateTime: timeStr,
    lastCheckTimestamp: now.getTime()
  })
}

/**
 * Acknowledge all updates (reset count and refresh cache)
 */
export async function acknowledgeUpdates(): Promise<void> {
  const config = loadConfig()
  const idsString = config.itunesIds || ''

  if (!idsString.trim()) return

  const resp = await fetchITunesData(idsString)
  if (!resp?.results) return

  const newCache: VersionCache = {}
  for (const app of resp.results) {
    newCache[app.trackId.toString()] = app.version
  }

  setVersionCache(newCache)
  updateConfig({
    updateCount: 0,
    updateNames: ''
  })
}

// =============================================================================
// Time Utilities
// =============================================================================

/**
 * Format date to HH:MM string
 */
export function formatTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * Get current formatted time
 */
export function getCurrentTime(): string {
  return formatTime(new Date())
}

// =============================================================================
// Widget Data Loader (optimized)
// =============================================================================

export interface WidgetData {
  apps: AppItem[]
  config: Config
  runTime: string
}

/**
 * Load all data needed for widget rendering (uses caching)
 */
export function loadWidgetData(): WidgetData {
  return {
    apps: loadApps(),    // Uses memory cache
    config: loadConfig(), // Uses memory cache
    runTime: getCurrentTime()
  }
}

/**
 * Preload widget data for faster rendering
 * Call this before Widget.present()
 */
export function preloadWidgetData(): void {
  loadApps()
  loadConfig()
}