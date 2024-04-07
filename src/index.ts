import { Context, Schema, h } from 'koishi'
import { } from 'koishi-plugin-puppeteer'
import { } from '@koishijs/plugin-server'

declare module 'koishi' {
  interface Tables {
    screenshot_console_bind: {
      id: string
      email: string
    }
  }
}

export const name = 'screenshot-console'
export const inject = ['puppeteer', 'database', 'server']

export const usage = `
<p>指令「插件市场搜索」支持多关键词搜索。例如，输入的指令：</p>
<p><code>插件市场搜索 按下载量 email:1919892171@qq.com</code></p>
`

export interface Config {
  accessPort: number
  searchMappings: {
    key: string
    value: string
  }[]
  enableViewLog: boolean
}

export const Config: Schema<Config> = Schema.object({
  accessPort: Schema.union([
    Schema.const(0).description('自动检测'),
    Schema.natural().description('自定义').default(5140)
  ]).description('访问的控制台端口').default(0),
  searchMappings: Schema
    .array(Schema.object({
      key: Schema.string().description('需转换'),
      value: Schema.string().description('转换后'),
    }))
    .role('table')
    .description('「插件市场搜索」关键词映射')
    .default([
      { key: '综合', value: 'sort:default' },
      { key: '按评分', value: 'sort:rating' },
      { key: '按下载量', value: 'sort:download' },
      { key: '按创建时间', value: 'sort:created' },
      { key: '按更新时间', value: 'sort:updated' },
      { key: '排除综合', value: 'sort:default-asc' },
      { key: '排除按评分', value: 'sort:rating-asc' },
      { key: '排除按下载量', value: 'sort:download-asc' },
      { key: '排除按创建时间', value: 'sort:created-asc' },
      { key: '排除按更新时间', value: 'sort:updated-asc' },
    ]),
  enableViewLog: Schema.boolean().description('是否启用「查看最近日志」指令').default(false)
})

export function apply(ctx: Context, cfg: Config) {
  ctx.model.extend('screenshot_console_bind', {
    id: 'string',
    email: 'string'
  })

  ctx.command('market-search <keyword:text>', '插件市场截图')
    .alias('插件市场搜索')
    .action(async ({ session }, keyword) => {
      const elements = h.select(keyword || '', 'text, at')
      if (elements.length === 0) return '请输入搜索关键词。'

      const bound: h[] = []
      for (const v of elements) {
        if (v.type === 'at') {
          const match = await ctx.database.get('screenshot_console_bind', {
            id: `${session.platform}:${session.guildId}:${v.attrs.id}`
          })
          if (match.length === 0) {
            bound.push(h.text(''))
            continue
          }
          bound.push(h.text('email:' + match[0].email))
          continue
        }
        bound.push(v)
      }

      const keywords = bound.toString().split(' ')
      const searchParams = []
      for (const k of keywords) {
        if (!k) continue
        const mapping = cfg.searchMappings.find(m => m.key === k)
        searchParams.push(encodeURIComponent(mapping ? mapping.value : k))
      }

      const port = cfg.accessPort || ctx.server.port
      if (!port) return '搜索失败。'

      const page = await ctx.puppeteer.page()
      await page.setViewport({
        width: 1160,
        height: 740
      })
      await page.goto(`http://127.0.0.1:${port}/market?keyword=${searchParams.join('+')}`, {
        waitUntil: 'networkidle2'
      })
      await page.addStyleTag({
        content: `
          .layout-status {
            display: none
          }
          div.package-list {
            padding: 6px
          }
          a.market-package button {
            display: none
          }
        `
      })

      const shooter = await page.$('div.package-list')
      let msg: h | string
      if (shooter) {
        const imgBuf = await shooter.screenshot({
          captureBeyondViewport: false
        })
        msg = h.image(imgBuf, 'image/png')
      } else if (await page.$('div.k-empty')) {
        msg = '没有搜索到相关插件。'
      } else if (await page.$('div.market-error')) {
        msg = '无法连接到插件市场。'
      } else {
        msg = '搜索失败。'
      }
      page.close()
      return msg
    })

  ctx.command('market-search.bind <target:user> <email:string>', '将用户与邮箱绑定')
    .alias('插件市场绑定邮箱')
    .action(async ({ session }, target, email) => {
      if (!target) {
        return '未指定用户。'
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return '邮箱格式不正确，请确保邮箱地址包含@符号。'
      }

      const userId = target.replace(session.platform + ':', '')

      await ctx.database.upsert('screenshot_console_bind', [{
        id: `${session.platform}:${session.guildId}:${userId}`,
        email
      }], 'id')

      return '邮箱绑定成功！'
    })

  if (cfg.enableViewLog) {
    ctx.command('view-log', '查看最近日志')
      .alias('查看最近日志')
      .action(async () => {
        const port = cfg.accessPort || ctx.server.port
        if (!port) return '日志获取失败。'

        const page = await ctx.puppeteer.page()
        await page.setViewport({
          width: 1125,
          height: 768
        })
        await page.goto(`http://127.0.0.1:${port}/logs`, {
          waitUntil: 'networkidle2'
        })

        const shooter = await page.$('div.log-list')
        let msg: h | string
        if (shooter) {
          const imgBuf = await shooter.screenshot({
            captureBeyondViewport: false
          })
          msg = h.image(imgBuf, 'image/png')
        } else {
          msg = '日志获取失败。'
        }
        page.close()
        return msg
      })
  }
}
