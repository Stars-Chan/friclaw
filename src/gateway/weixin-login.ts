// src/gateway/weixin-login.ts
import { logger } from '../utils/logger'
import QRCode from 'qrcode-terminal'

interface QRCodeResp {
  qrcode: string
  qrcode_img_content: string
}

interface StatusResp {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired'
  bot_token?: string
}

export async function loginWithQR(baseUrl: string, timeoutMs = 300000, pollIntervalMs = 2000): Promise<string> {
  try {
    const qrResp = await fetch(`${baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3`)
    if (!qrResp.ok) throw new Error(`获取二维码失败: ${qrResp.status}`)

    const data = await qrResp.json() as QRCodeResp
    logger.info({ data }, 'API 返回')

    const qrUrl = data.qrcode_img_content || data.qrcode
    if (!qrUrl) throw new Error('未获取到二维码链接')

    logger.info('请用微信扫描以下二维码登录：')
    QRCode.generate(qrUrl, { small: true })
    logger.info({ qrUrl }, '二维码链接')

    const qrcode = data.qrcode
    const startTime = Date.now()
    let scanned = false

    while (true) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error('登录超时')
      }

      const statusResp = await fetch(`${baseUrl}/ilink/bot/get_qrcode_status?qrcode=${qrcode}`)
      const status = await statusResp.json() as StatusResp

      if (status.status === 'confirmed' && status.bot_token) {
        logger.info('登录成功')
        return status.bot_token
      }
      if (status.status === 'expired') throw new Error('二维码已过期')

      if (status.status === 'scaned' && !scanned) {
        scanned = true
        logger.info('二维码已扫描，等待确认...')
      }

      await new Promise(r => setTimeout(r, scanned ? 1000 : pollIntervalMs))
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('fetch')) {
      throw new Error(`网络请求失败: ${err.message}`)
    }
    throw err
  }
}
