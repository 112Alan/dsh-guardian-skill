// dsh-rollback（宿主端）：对话崩溃自动回退（分支式回退）
//
// 行为：
//   监听 agent/error。当某个回合以错误结束、且该回合没有产生任何助手输出
//   （assistant/message、assistant/chunk、tool/call、tool/result）时，说明
//   这条消息根本没有发出去——此时用 DSH 原生的 sessions.fork 在「发送前」
//   的序列号检查点派生一个干净会话，并把 { childId } 放进待取队列。
//   客户端（lib/client.js）每 2 秒轮询 /rollback-api?sessionId=xxx 拿到
//   childId 后自动打开新会话，对话即回到发送前状态。
//
// 安全性：
//   - 只调用官方 fork 原语，不重写会话日志、不触碰存储，零损坏风险；
//   - 回合已有真实输出（哪怕部分）=> 不回退，避免丢内容；
//   - 同一会话 30 秒内只回退一次（防抖）。

export const name = 'dsh-rollback'
// 等 sessions 与 webServer 都挂载后再 apply，确保 /rollback-api 路由能注册
export const inject = ['sessions', 'webServer']

const OUTPUT_TYPES = new Set(['assistant/message', 'assistant/chunk', 'tool/call', 'tool/result'])
const THROTTLE_MS = 30000

export function apply(ctx) {
  const sessions = ctx.get('sessions')
  if (sessions === undefined) return
  const webServer = ctx.get('webServer')
  const workspaceRegistry = ctx.get('workspaceRegistry')

  // sessionId -> { turn, seq }：当前回合的「发送前」检查点
  const checkpoints = new Map()
  // sessionId -> 时间戳：防抖
  const lastRollback = new Map()
  // sessionId -> { childId, reason }：待客户端取走的回退结果
  const pending = new Map()

  function turnProducedOutput(session, turn) {
    for (const ev of session.events) {
      if (ev.data === null || typeof ev.data !== 'object') continue
      if (ev.data.turn !== turn) continue
      if (OUTPUT_TYPES.has(ev.type)) return true
    }
    return false
  }

  // 向派生会话追加「错误报告 + 询问」上下文消息（notice 形式，可折叠；模型后续回合可见）
  function appendFeedback(child, turn, step, reason) {
    try {
      const text = '【已自动回退】上一条消息未能成功发送。\n\n'
        + '出错位置：第 ' + turn + ' 回合第 ' + step + ' 步\n'
        + '错误信息：' + reason + '\n\n'
        + '已自动回到发送前的状态，原始任务内容与进度保持不变。\n'
        + '请问：需要我修复这个问题（重试 / 调整参数 / 检查配置），还是换一种方式继续执行任务？'
      child.append('user/message', {
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: 'dsh-rollback', form: 'notice', summary: '检测到错误，已自动回退（详见内容）' },
      }, { surfaceOp: 'append' })
    } catch (e) {
      console.error('[dsh-rollback] append feedback failed:', e)
    }
  }

  // 把派生会话挂回源会话的工作区（避免出现在「未分组」）
  async function attachToWorkspace(sourceSession, childId) {
    if (workspaceRegistry === undefined) return
    try {
      let workspace
      const cwd = sourceSession.header && sourceSession.header.cwd
      if (cwd !== undefined) workspace = await workspaceRegistry.resolveByPath(cwd)
      if (workspace === undefined) {
        for (const ws of workspaceRegistry.list()) {
          if (ws.sessionIds.includes(sourceSession.id)) { workspace = ws; break }
        }
      }
      if (workspace !== undefined) await workspace.attachSession(childId)
    } catch (e) {
      console.error('[dsh-rollback] workspace attach failed:', e)
    }
  }

  ctx.on('agent/created', ({ agent }) => {
    const sid = agent.session.id
    agent.ctx.on('session/event', (session, event) => {
      if (event.type === 'turn/start') {
        // turn/start 本身在 UI 不可见；检查点取它之前最后一个事件的 seq
        checkpoints.set(sid, { turn: event.data.turn, seq: event.seq - 1 })
      } else if (event.type === 'turn/end') {
        checkpoints.delete(sid)
      }
    })
    agent.ctx.on('agent/error', async ({ agent: a, turn, step, error }) => {
      const session = (a && a.session) || agent.session
      const cp = checkpoints.get(sid)
      if (cp === undefined || cp.turn !== turn) return
      // 首条消息就失败：没有可回退的「发送前」状态，跳过
      if (cp.seq < 0) return
      // 回合已产生真实输出 => 不动，避免丢内容
      if (turnProducedOutput(session, turn)) return
      const now = Date.now()
      const last = lastRollback.get(sid)
      if (last !== undefined && now - last < THROTTLE_MS) return
      try {
        const child = sessions.fork(session, cp.seq)
        lastRollback.set(sid, now)
        const reason = error && typeof error.message === 'string' ? error.message : String(error)
        appendFeedback(child, turn, step === undefined ? 1 : step, reason.slice(0, 300))
        await attachToWorkspace(session, child.id)
        pending.set(sid, { childId: child.id, reason: reason.slice(0, 300) })
        console.log(`[dsh-rollback] session ${sid} turn ${turn} failed with no output; forked clean child ${child.id} at seq ${cp.seq}`)
      } catch (e) {
        console.error('[dsh-rollback] fork failed:', e)
      }
    })
  })

  ctx.on('agent/disposed', ({ agent }) => {
    if (agent && agent.session) checkpoints.delete(agent.session.id)
  })

  // 客户端轮询接口：GET /rollback-api?sessionId=xxx -> { ok, rollback: {childId, reason} | null }
  if (webServer !== undefined) {
    const disposeRoute = webServer.register({
      kind: 'exact',
      path: '/rollback-api',
      handler: (req, res) => {
        let sid = null
        const raw = req.url || ''
        const q = raw.indexOf('?')
        if (q >= 0) sid = new URLSearchParams(raw.slice(q + 1)).get('sessionId')
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        if (!sid) {
          res.end(JSON.stringify({ ok: false, error: 'missing sessionId' }))
          return
        }
        const p = pending.get(sid)
        if (p === undefined) {
          res.end(JSON.stringify({ ok: true, rollback: null }))
          return
        }
        pending.delete(sid)
        res.end(JSON.stringify({ ok: true, rollback: p }))
      }
    })
    ctx.effect(() => disposeRoute)
  }
}
