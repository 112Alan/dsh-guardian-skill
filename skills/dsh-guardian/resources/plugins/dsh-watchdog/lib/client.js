// dsh-watchdog (client bundle) — settings card bound to the 'watchdog' namespace.
// Renders under 设置 → 插件 → 插件配置 as a "看门狗" card with three fields:
// enabled / intervalSeconds / watchVisionProxy. Each change writes the field
// immediately through the settings scope. An error boundary surfaces any
// render failure as visible text instead of a blank card.

window.__ModuleLoader__.load({
  id: '@deepseek-ai/dsh-watchdog',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')

    var NS = 'watchdog'

    function cardStyle() {
      return {
        display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px 0',
        fontFamily: 'inherit', color: 'var(--dsw-alias-label-primary)',
      }
    }
    function titleStyle() {
      return { margin: '0', fontSize: '15px', fontWeight: '600', lineHeight: '1.4' }
    }
    function rowStyle() {
      return { display: 'flex', alignItems: 'center', gap: '8px', minHeight: '34px' }
    }
    function labelStyle() {
      return { flex: '1', fontSize: '13px', lineHeight: '1.5' }
    }
    function hintStyle() {
      return { color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', lineHeight: '1.5', margin: '0' }
    }
    function errStyle() {
      return { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px', lineHeight: '1.5', margin: '0' }
    }
    function inputStyle() {
      return {
        border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)',
        height: '34px', color: 'var(--dsw-alias-label-primary)', borderRadius: '8px',
        padding: '0 12px', fontSize: '13px', width: '160px',
      }
    }

    // --- error boundary (class component, no hooks) ---
    var Boundary = (function () {
      var cls = function (props) { this.state = { err: null } }
      cls.prototype = Object.create(React.Component.prototype)
      cls.prototype.constructor = cls
      cls.prototype.componentDidCatch = function (error) {
        this.setState({ err: String(error && error.message || error) })
      }
      cls.prototype.render = function () {
        if (this.state.err) {
          return React.createElement('div', { style: cardStyle() },
            React.createElement('p', { style: errStyle() }, '看门狗卡片渲染失败：' + this.state.err))
        }
        return this.props.children
      }
      return cls
    })()

    var plugin = {
      name: 'dsh-watchdog-client',
      apply: function (ctx) {
        var slots = ctx.get('slots')
        var settingsScope = ctx.get('settingsScope')
        if (!slots || !settingsScope) return

        var scope
        try { scope = settingsScope.bind({ namespace: NS }) } catch (e) { scope = null }

        function WatchdogCard() {
          var snapState = React.useState(function () {
            try { return scope ? scope.getSnapshot() : null } catch (e) { return null }
          })
          var snap = snapState[0]
          var setSnap = snapState[1]
          var value = snap && snap.value ? snap.value : {}

          var enabledState = React.useState(value.enabled !== false)
          var enabled = enabledState[0]
          var setEnabled = enabledState[1]
          var intervalState = React.useState(String(value.intervalSeconds || 10))
          var interval = intervalState[0]
          var setInterval = intervalState[1]
          var visionState = React.useState(value.watchVisionProxy === true)
          var vision = visionState[0]
          var setVision = visionState[1]

          React.useEffect(function () {
            if (!scope) return
            return scope.subscribe(function () {
              var next
              try { next = scope.getSnapshot() } catch (e) { return }
              setSnap(next)
              if (next && next.value) {
                if (typeof next.value.enabled === 'boolean') setEnabled(next.value.enabled)
                if (typeof next.value.intervalSeconds === 'number') setInterval(String(next.value.intervalSeconds))
                if (typeof next.value.watchVisionProxy === 'boolean') setVision(next.value.watchVisionProxy)
              }
            })
          }, [])

          var writable = !snap || snap.writable !== false

          if (snap && snap.status === 'unavailable') {
            return React.createElement('div', { style: cardStyle() },
              React.createElement('p', { style: titleStyle() }, '看门狗'),
              React.createElement('p', { style: hintStyle() }, '看门狗设置不可用（命名空间未暴露）。'))
          }

          function commitInterval() {
            var n = parseInt(interval, 10)
            if (!isFinite(n)) return
            if (n < 2) n = 2
            if (n > 300) n = 300
            setInterval(String(n))
            if (writable && scope) scope.set('intervalSeconds', n).catch(function () {})
          }

          return React.createElement('div', { style: cardStyle() },
            React.createElement('p', { style: titleStyle() }, '看门狗'),
            React.createElement('div', { style: rowStyle() },
              React.createElement('label', { style: labelStyle() }, '启用看门狗'),
              React.createElement('input', {
                type: 'checkbox', checked: enabled, disabled: !writable,
                onChange: function (e) {
                  setEnabled(e.target.checked)
                  if (writable && scope) scope.set('enabled', e.target.checked).catch(function () {})
                },
              })),
            React.createElement('div', { style: rowStyle() },
              React.createElement('label', { style: labelStyle() }, '检测间隔（秒）'),
              React.createElement('input', {
                type: 'number', min: 2, max: 300, value: interval, disabled: !writable,
                style: inputStyle(),
                onChange: function (e) { setInterval(e.target.value) },
                onBlur: commitInterval,
                onKeyDown: function (e) { if (e.key === 'Enter') commitInterval() },
              })),
            React.createElement('div', { style: rowStyle() },
              React.createElement('label', { style: labelStyle() }, '视觉代理兜底（8083）'),
              React.createElement('input', {
                type: 'checkbox', checked: vision, disabled: !writable,
                onChange: function (e) {
                  setVision(e.target.checked)
                  if (writable && scope) scope.set('watchVisionProxy', e.target.checked).catch(function () {})
                },
              })),
            React.createElement('p', { style: hintStyle() },
              'DSH 崩溃后自动重启守护（30 秒防抖）；意向停止请用 /dsh-stop。设置写入后立即生效。'))
        }

        slots.inject('settings.plugin.item', function () {
          return slots.register({
            name: 'settings.plugin.item',
            id: 'watchdog',
            order: 30,
            label: '看门狗',
          }, function (props) {
            return React.createElement(Boundary, null, React.createElement(WatchdogCard, props))
          })
        })
      }
    }

    module.exports = plugin
    return module.exports
  }
})
