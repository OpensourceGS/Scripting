import {
  Color,
  Image,
  Link,
  RoundedRectangle,
  ZStack
} from 'scripting'
import { AppItem, Config, getIconCachePath } from '../constants'

interface AppIconProps {
  item: AppItem
  config: Config
}

/**
 * App icon component for widget display
 */
export function AppIcon({ item, config }: AppIconProps) {
  const size = config.iconSize || 50
  const radius = config.shape === 'circle' ? size / 2 : size * 0.225
  const cachePath = getIconCachePath(item.icon)
  const imageExists = item.iconType === 'image' && !!cachePath && FileManager.existsSync(cachePath)
  const renderingMode = config.widgetAccentedRenderingMode || 'fullColor'

  return (
    <Link url={item.url} buttonStyle='plain'>
      <ZStack
        frame={{ width: size, height: size }}
        clipShape={{ type: 'rect', cornerRadius: radius }}
      >
        {!imageExists && (
          <RoundedRectangle
            fill={(item.color || '#8E8E93') as Color}
            cornerRadius={radius}
            widgetAccentable={false}
          />
        )}

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
    </Link>
  )
}