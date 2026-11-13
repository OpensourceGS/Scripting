import { Navigation, Script } from "scripting"
import { OverallView } from "./components/OverallView"

async function run(): Promise<void> {
  await Navigation.present({
    element: <OverallView />,
  })

  // 视图关闭后退出脚本（Scripting 推荐模式）
  Script.exit()
}

run()
