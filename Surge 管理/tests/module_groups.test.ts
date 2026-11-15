import { Script } from "scripting"
import { groupModules } from "../utils/module_groups"

type Item = { name: string; category?: string }
let passed = 0
function check(condition: boolean, name: string): void {
  if (!condition) throw new Error(`未通过：${name}`)
  passed += 1
}
const items: Item[] = [
  { name: "A", category: "功能" }, { name: "B", category: "旧分类" },
  { name: "C" }, { name: "D", category: " 广告 " },
  { name: "E", category: "功能" }, { name: "F", category: "未分类" },
]
const groups = groupModules(items, ["广告", "功能", "功能", "空分类"])
check(groups.map(group => group.id).join("|") === "广告|功能|旧分类|未分类|", "配置顺序、去重与未知分类保留")
check(groups.flatMap(group => group.items).length === items.length, "全部模块恰好分组一次")
check(groups.find(group => group.id === "功能")?.items.map(item => item.name).join() === "A,E", "分类内保持原排序")
check(groups.filter(group => group.title === "未分类").length === 2, "同名分类与空分类标识不冲突")
check(groupModules([], ["功能"]).length === 0, "空数据无空分组")
check(groupModules(items, []).flatMap(group => group.items).length === items.length, "无配置仍保留全部模块")
check(items[3].category === " 广告 ", "不修改原始数据")
Script.exit({ passed, message: "分组回归测试通过" })
