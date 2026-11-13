export type ResourceKind = "module" | "rule"
export type Destination = "local" | "surge"

export function resourceLabel(kind: ResourceKind): string {
  return kind === "module" ? "模块" : "分流"
}

export function validateURL(raw: string): string {
  const value: string = raw.trim()
  if (!/^https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/i.test(value)) {
    throw new Error("请输入有效的 HTTP / HTTPS 下载链接")
  }
  return value
}

export function validateFileName(raw: string, kind: ResourceKind): string {
  const name: string = raw.trim()
  if (!name || name.startsWith(".") || /[/\\\x00-\x1f\x7f:]/.test(name) || name.length > 180) {
    throw new Error("文件名不能为空、以点开头或包含路径分隔符等特殊字符（最多 180 字符）")
  }
  const result: string = /\.[^.]+$/.test(name) ? name : `${name}${kind === "module" ? ".sgmodule" : ".list"}`
  if (!isResourceFile(result, kind)) {
    throw new Error(kind === "module" ? "模块文件请使用 .sgmodule" : "分流文件支持 .list / .rules / .ruleset / .txt")
  }
  return result
}

export function isResourceFile(name: string, kind: ResourceKind): boolean {
  return kind === "module" ? /\.sgmodule$/i.test(name) : /\.(list|rules|ruleset|txt)$/i.test(name)
}

export function suggestedName(url: string, kind: ResourceKind): string {
  try {
    const leaf: string = decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() ?? "")
    return validateFileName(leaf, kind)
  } catch {
    return kind === "module" ? "新模块.sgmodule" : "新分流.list"
  }
}
