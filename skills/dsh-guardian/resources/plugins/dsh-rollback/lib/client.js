// dsh-rollback（客户端 bundle，由 client-modules 经 package.json 的
// dsh.client 声明加载，浏览器直接执行本文件）。
//
// 行为：每 2 秒轮询 /rollback-api?sessionId=<当前会话>，一旦宿主端已为
// 当前会话派生回退会话（childId），立即自动打开它 —— 对话回到发送前状态。
// 纯 apply 实现，不挂槽位、不用 React。

window.__ModuleLoader__.load({
  id: '@deepseek-ai/dsh-rollback',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var POLL_MS = 2000

    var plugin = {
      name: 'dsh-rollback-client',
      apply: function (ctx) {
        var sessions = ctx.get('sessions')
        var timer = ctx.get('timer')
        if (!sessions || !timer) return

        // 已处理过的会话（避免重复打开同一个回退结果）
        var opened = Object.create(null)

        function poll() {
          var state = sessions.list.getSnapshot()
          var sid = state && state.current
          if (!sid || opened[sid]) return
          fetch('/rollback-api?sessionId=' + encodeURIComponent(sid), { cache: 'no-store' })
            .then(function (r) { return r.json() })
            .then(function (data) {
              if (data && data.ok && data.rollback && data.rollback.childId) {
                opened[sid] = true
                sessions.open(data.rollback.childId)
              }
            })
            .catch(function () {})
        }

        poll()
        var dispose = timer.interval(poll, POLL_MS)
        ctx.effect(function () { return dispose })
      }
    }

    module.exports = plugin
    return module.exports
  }
})
