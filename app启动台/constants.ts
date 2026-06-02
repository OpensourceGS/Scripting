import { Path, Script } from 'scripting'

// =============================================================================
// Path Constants
// =============================================================================

export const BASE_PATH = Path.join(
  FileManager.appGroupDocumentsDirectory,
  Script.name
)
export const FILE_PATH = Path.join(BASE_PATH, 'launcher_apps.json')
export const CONFIG_PATH = Path.join(BASE_PATH, 'launcher_config.json')
export const CACHE_PATH = Path.join(BASE_PATH, 'cache')

// =============================================================================
// Types
// =============================================================================

export type IconShape = 'rounded' | 'circle'
export type IconType = 'symbol' | 'image'
export type WidgetAccentedRenderingMode =
  | 'accented'
  | 'desaturated'
  | 'accentedDesaturated'
  | 'fullColor'

export interface AppItem {
  id: string
  name: string
  icon: string
  iconType?: IconType
  url: string
  color: string
  category?: string
  bundleId?: string  // 用于 Widget.openApp 直接打开 App
}

export interface Config {
  shape: IconShape
  iconSize: number
  spacing: number
  widgetAccentedRenderingMode: WidgetAccentedRenderingMode
  itunesIds?: string
  updateCount?: number
  updateNames?: string
  backgroundImagePath?: string
  lastUpdateTime?: string
  lastCheckTimestamp?: number
  refreshInterval?: number
}

// =============================================================================
// Default Values
// =============================================================================

export const DEFAULT_CONFIG: Config = {
  shape: 'rounded',
  iconSize: 50,
  spacing: 15,
  widgetAccentedRenderingMode: 'fullColor',
  itunesIds: '',
  updateCount: 0,
  updateNames: '',
  backgroundImagePath: '',
  lastUpdateTime: '',
  lastCheckTimestamp: 0,
  refreshInterval: 240
}

export const DEFAULT_APPS: AppItem[] = [
  // Finance
  {
    id: 'taobao',
    name: '淘宝',
    icon: 'https://raw.githubusercontent.com/OpensourceGS/tuchuang/main/Appicon/blackW/TB.png',
    iconType: 'image',
    url: 'taobao://',
    bundleId: 'com.taobao.taobao4iphone',
    color: '#FF5000',
    category: '𝑭𝒊𝒏𝒂𝒏𝒄𝒆'
  },
  {
    id: 'pinduoduo',
    name: '拼多多',
    icon: 'https://raw.githubusercontent.com/OpensourceGS/tuchuang/main/Appicon/blackW/PDD.png',
    iconType: 'image',
    url: 'pinduoduo://',
    bundleId: 'com.xunmeng.pinduoduo',
    color: '#E02E24',
    category: '𝑭𝒊𝒏𝒂𝒏𝒄𝒆'
  },
  {
    id: 'jd',
    name: '京东',
    icon: 'https://raw.githubusercontent.com/OpensourceGS/tuchuang/main/Appicon/blackW/JD.png',
    iconType: 'image',
    url: 'openapp.jdmobile://',
    bundleId: 'com.360buy.jdmobile',
    color: '#F2270C',
    category: '𝑭𝒊𝒏𝒂𝒏𝒄𝒆'
  },
  {
    id: 'meituan',
    name: '美团',
    icon: 'https://raw.githubusercontent.com/OpensourceGS/tuchuang/main/Appicon/blackW/MT.png',
    iconType: 'image',
    url: 'imeituan://',
    bundleId: 'com.meituan.imeituan',
    color: '#FFC300',
    category: '𝑭𝒊𝒏𝒂𝒏𝒄𝒆'
  },
  // Daily
  {
    id: 'nnf',
    name: 'Netsnewsfire',
    icon: 'https://raw.githubusercontent.com/OpensourceGS/tuchuang/main/Appicon/blackW/NNF.JPG',
    iconType: 'image',
    url: 'NetNewsWire://',
    bundleId: 'com.ranchero.NetNewsWire.iOS',
    color: '#007AFF',
    category: '𝑫𝒂𝒊𝒍𝒚'
  },
  {
    id: 'forward',
    name: 'Forward',
    icon: 'https://raw.githubusercontent.com/OpensourceGS/tuchuang/main/Appicon/blackW/FW.png',
    iconType: 'image',
    url: 'forward://',
    bundleId: 'flux.inchmade.app',
    color: '#5856D6',
    category: '𝑫𝒂𝒊𝒍𝒚'
  },
  {
    id: 'kuwo',
    name: '酷我音乐',
    icon: 'https://raw.githubusercontent.com/OpensourceGS/tuchuang/main/Appicon/blackW/KW.png',
    iconType: 'image',
    url: 'com.kuwo.kwmusic.kwmusicForKwsing://',
    bundleId: 'com.yeelion.kwplayer',
    color: '#16D3E1',
    category: '𝑫𝒂𝒊𝒍𝒚'
  },
  {
    id: 'xhs',
    name: '小红书',
    icon: 'https://raw.githubusercontent.com/OpensourceGS/tuchuang/main/Appicon/blackW/XHS.png',
    iconType: 'image',
    url: 'xhsdiscover://',
    bundleId: 'com.xingin.discover',
    color: '#FE2C55',
    category: '𝑫𝒂𝒊𝒍𝒚'
  },
  // Social
  {
    id: 'qq',
    name: 'QQ',
    icon: 'https://raw.githubusercontent.com/OpensourceGS/tuchuang/main/Appicon/blackW/QQ.png',
    iconType: 'image',
    url: 'mqq://',
    bundleId: 'com.tencent.mqq',
    color: '#12B7F5',
    category: '𝑺𝒐𝒄𝒊𝒂𝒍'
  },
  {
    id: 'swiftgram',
    name: 'Swiftgram',
    icon: 'https://raw.githubusercontent.com/OpensourceGS/tuchuang/main/Appicon/blackW/sg.png',
    iconType: 'image',
    url: 'sg://',
    bundleId: 'app.swiftgram.ios',
    color: '#24A1DE',
    category: '𝑺𝒐𝒄𝒊𝒂𝒍'
  },
  {
    id: 'amap',
    name: '高德地图',
    icon: 'https://raw.githubusercontent.com/OpensourceGS/tuchuang/main/Appicon/blackW/AMAP.png',
    iconType: 'image',
    url: 'iosamap://',
    bundleId: 'com.autonavi.amap',
    color: '#4287FF',
    category: '𝑺𝒐𝒄𝒊𝒂𝒍'
  },
  {
    id: 'alipay',
    name: '支付宝',
    icon: 'https://raw.githubusercontent.com/OpensourceGS/tuchuang/main/Appicon/blackW/alipay.png',
    iconType: 'image',
    url: 'alipay://',
    bundleId: 'com.alipay.iphoneclient',
    color: '#1677FF',
    category: '𝑺𝒐𝒄𝒊𝒂𝒍'
  },
  // Tools
  {
    id: 'drafts',
    name: 'Drafts',
    icon: 'https://raw.githubusercontent.com/OpensourceGS/tuchuang/main/Appicon/blackW/DRAFTS.png',
    iconType: 'image',
    url: 'drafts://',
    bundleId: 'com.agiletortoise.Drafts5',
    color: '#FF9500',
    category: '𝑻𝒐𝒐𝒍𝒔'
  },
  {
    id: 'paratrans',
    name: 'Para翻译',
    icon: 'https://raw.githubusercontent.com/OpensourceGS/tuchuang/main/Appicon/blackW/PARATRANS.png',
    iconType: 'image',
    url: 'ParaTranslate://main?type=text&value=',
    bundleId: 'com.translate.qtrans',
    color: '#5AC8FA',
    category: '𝑻𝒐𝒐𝒍𝒔'
  },
  {
    id: 'quickscan',
    name: '一扫',
    icon: 'https://raw.githubusercontent.com/OpensourceGS/tuchuang/main/Appicon/blackW/YS.png',
    iconType: 'image',
    url: 'quickScan://',
    bundleId: 'com.Sumqt.QuickScan',
    color: '#4CD964',
    category: '𝑻𝒐𝒐𝒍𝒔'
  },
  {
    id: 'acs',
    name: '爱传送',
    icon: 'https://raw.githubusercontent.com/OpensourceGS/tuchuang/main/Appicon/blackW/ACS.JPG',
    iconType: 'image',
    url: 'mfiles://transfer-clipboard',
    bundleId: 'com.windtune.itransferios',
    color: '#007AFF',
    category: '𝑻𝒐𝒐𝒍𝒔'
  }
]

// =============================================================================
// Widget Style Constants
// =============================================================================

export const WIDGET_STYLES = {
  headerOffset: { x: -8, y: -6 },
  contentOffset: { x: 0, y: -6 },
  badge: {
    width: 42,
    height: 17,
    cornerRadius: 4
  },
  fonts: {
    badge: 10,
    subtitle: 11,
    category: 12,
    appName: 16,
    appUrl: 12
  },
  colors: {
        textPrimaryLight: '#000000',
        textPrimaryDark: '#FFFFFF',
        textSecondary: '#8E8E93',
        cardBackground: '#1C1C1E'
      },
  spacing: {
    headerHeight: 32,
    groupSpacing: 8,
    itemSpacing: 4,
    rowSpacing: 10
  }
} as const

// =============================================================================
// Update Check Constants
// =============================================================================

export const UPDATE_CHECK_COOLDOWN = 5 * 60 * 1000 // 5 minutes in milliseconds
export const ITUNES_API_BASE = 'https://itunes.apple.com/lookup'

// =============================================================================
// Utility Functions
// =============================================================================

/** Memory cache for MD5 hash results to avoid repeated crypto operations */
const _hashCache = new Map<string, string>()

/**
 * Normalize GitHub URL to raw content URL
 */
export function normalizeGithubUrl(url: string): string {
  if (url.includes('github.com') && url.includes('/blob/')) {
    return url
      .replace('github.com', 'raw.githubusercontent.com')
      .replace('/blob/', '/')
  }
  return url
}

/**
 * Get cache path for an icon URL (with hash caching for performance)
 */
export function getIconCachePath(url: string): string {
  if (!url || typeof url !== 'string') return ''

  const normalizedUrl = normalizeGithubUrl(url)

  // Check cache first
  const cachedHash = _hashCache.get(normalizedUrl)
  if (cachedHash) {
    return Path.join(CACHE_PATH, `${cachedHash}.png`)
  }

  try {
    const data = Data.fromRawString(normalizedUrl)
    if (!data) return ''
    const hash = Crypto.md5(data).toHexString()
    
    // Cache the hash for future use
    _hashCache.set(normalizedUrl, hash)
    
    return Path.join(CACHE_PATH, `${hash}.png`)
  } catch (e) {
    console.error('Failed to generate icon cache path', e)
    return ''
  }
}

/**
 * Clear the hash cache (useful if cache directory changes)
 */
export function clearHashCache(): void {
  _hashCache.clear()
}