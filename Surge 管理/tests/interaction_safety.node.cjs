// Node 测试：抽取当前函数，仅去除 TypeScript 注解；不连接 Surge、不读写模块文件。
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const home = fs.readFileSync(path.join(__dirname, '../components/HomeView.tsx'), 'utf8')
const motion = fs.readFileSync(path.join(__dirname, '../utils/motion.ts'), 'utf8')
const start = home.indexOf('  async function toggleRemoteModule(')
const end = home.indexOf('\n  }\n', start) + 5
assert(start >= 0 && end > start, '找不到待测函数')
const toggleSource = home.slice(start, end)
  .replace('target: ModuleInfo, nextValue: boolean', 'target, nextValue')
  .replace('catch (e: any)', 'catch (e)')
const feedbackStart = motion.indexOf('export function playFeedback(')
const feedbackEnd = motion.indexOf('\n}', feedbackStart) + 2
const feedbackSource = motion.slice(feedbackStart, feedbackEnd)
  .replace('export function playFeedback(effect: () => void): void', 'function playFeedback(effect)')
const playFeedback = new Function(`return (${feedbackSource})`)()

async function checkRemoteFailureModes() {
  let calls = 0
  let release, reject
  let enabled = new Set()
  let toggling = new Set()
  const env = {
    scanPending: { current: false }, actionLock: { current: false }, busy: false,
    togglingModuleNames: toggling, remoteControlReady: true, cfg: {},
    remoteGeneration: { current: 0 }, getModuleRemoteName: item => item.name,
    HapticFeedback: {
      softImpact() { throw new Error('触觉不可用') },
      notificationSuccess() { throw new Error('触觉不可用') },
      notificationError() { throw new Error('触觉不可用') },
    },
    playFeedback, Dialog: { alert: async () => {} },
    setTogglingModuleNames(update) { toggling = update(toggling) },
    setEnabledModuleNames(update) { enabled = update(enabled) },
    setRemoteModuleEnabled() {
      calls += 1
      return new Promise((resolve, fail) => { release = resolve; reject = fail })
    },
  }
  const toggle = new Function('env', `with (env) { return (${toggleSource}) }`)(env)
  const first = toggle({ name: 'fixture' }, true)
  await toggle({ name: 'fixture' }, false)
  assert.equal(calls, 1, '同一渲染状态下只允许一个请求')
  assert.equal(env.actionLock.current, true, '远程等待中持续持锁')
  assert(enabled.has('fixture'), '乐观状态已更新')
  release()
  await first
  assert(enabled.has('fixture'), '成功触觉失败不应回滚已成功的请求')
  assert.equal(env.actionLock.current, false, '成功后释放锁')
  assert.equal(toggling.size, 0, '成功后清除进行中状态')
  const failure = toggle({ name: 'fixture' }, false)
  reject(new Error('模拟远程失败'))
  await failure
  assert(enabled.has('fixture'), '远程失败恢复之前启用状态')
  assert.equal(env.actionLock.current, false, '失败触觉抛错仍释放锁')
  assert.equal(toggling.size, 0, '失败后清除进行中状态')
  return 9
}

checkRemoteFailureModes().then(passed => {
  console.log(JSON.stringify({ passed, scope: '实际远程切换函数 + 实际触觉隔离函数，外部依赖均为测试替身' }))
}).catch(error => { console.error(error); process.exitCode = 1 })
