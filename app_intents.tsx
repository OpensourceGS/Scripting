import { AppIntentManager, AppIntentProtocol, Widget } from 'scripting'
import { performAppUpdateCheck, acknowledgeUpdates } from './utils'

export const RefreshIntent = AppIntentManager.register({
    name: 'RefreshIntent',
    protocol: AppIntentProtocol.AppIntent,
    perform: async () => {
        await performAppUpdateCheck()
    }
})

export const AcknowledgeIntent = AppIntentManager.register({
    name: 'AcknowledgeIntent',
    protocol: AppIntentProtocol.AppIntent,
    perform: async () => {
        await acknowledgeUpdates()
    }
})

/**
 * Open app by bundle ID (for Widget.openApp)
 * @param bundleId The bundle ID of the app to open
 */
export const OpenAppIntent = AppIntentManager.register({
    name: 'OpenAppIntent',
    protocol: AppIntentProtocol.AppIntent,
    perform: async (bundleId: string) => {
        Widget.openApp(bundleId)
    }
})
