// 官方文档：Animation and Transition / Liquid Glass Effect。
// 当前没有公开的系统 Reduce Motion 读取接口，因此提供显式偏好，不猜测环境属性。
export const REDUCE_MOTION_KEY = "surge_reduce_motion_v1"
export const supportsGlass = Number.parseInt(Device.systemVersion, 10) >= 26

export function motionEnabled(): boolean {
  return Storage.get<boolean>(REDUCE_MOTION_KEY) !== true
}

// 触觉属于可选反馈，失败不应阻断操作或把成功请求当成失败回滚。
export function playFeedback(effect: () => void): void {
  try { effect() } catch { /* 无触觉设备或桥接异常时静默降级。 */ }
}

// 只提交同步 UI 状态；网络、文件操作及列表切换不进入动画事务。
export function animateState(change: () => void): void {
  if (!motionEnabled()) { change(); return }
  void withAnimation(Animation.smooth({ duration: 0.28, extraBounce: 0 }), change)
}
