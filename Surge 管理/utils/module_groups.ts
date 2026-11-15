export type ModuleGroup<T> = { id: string; title: string; items: T[] }

// 配置决定顺序，而不是可见性：历史分类和未分类文件都必须保留。
export function groupModules<T extends { category?: string }>(items: T[], categories: string[]): ModuleGroup<T>[] {
  const buckets = new Map<string, T[]>()
  for (const item of items) {
    const key = item.category?.trim() ?? ""
    const bucket = buckets.get(key) ?? []
    bucket.push(item)
    buckets.set(key, bucket)
  }
  const order = [...new Set([...categories.map(value => value.trim()).filter(Boolean), ...buckets.keys()])]
  return order.filter(key => key !== "" && buckets.has(key)).concat(buckets.has("") ? [""] : [])
    .map(key => ({ id: key, title: key || "未分类", items: buckets.get(key)! }))
}
