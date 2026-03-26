/**
 * 流式响应内容格式化工具
 */

const CONTENT_SEPARATOR = '\n\n---\n\n'
const THINKING_LABEL = '💭 **思考过程**'

/**
 * 飞书卡片不支持外部图片URL，需要将markdown图片语法转换为链接
 * 将 ![](url) 转换为 [图片](url)
 */
export function sanitizeForFeishuCard(text: string): string {
  // 匹配markdown图片语法：![alt](url) 或 ![](url)
  return text.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt, url) => {
      // 如果是飞书内部的图片key（img:*格式），保留
      if (url.startsWith('img:')) {
        return match
      }
      // 外部URL转换为链接
      const altText = alt || '图片'
      return `[${altText}](${url})`
    }
  )
}

/**
 * 将文本转换为 Markdown 引用格式
 * @param text - 原始文本
 * @returns 引用格式的文本
 */
function toBlockquote(text: string): string {
  return text
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
}

/**
 * 构建流式响应内容（思考过程 + 文本 + 统计）
 * @param options - 构建选项
 * @returns 格式化后的内容字符串
 */
export function buildStreamContent(options: {
  thinking?: string
  text?: string
  stats?: string | null
}): string {
  const parts: string[] = []

  if (options.thinking) {
    // 使用引用块包裹思考内容，视觉上更紧凑且易于区分
    parts.push(`${THINKING_LABEL}\n\n${toBlockquote(options.thinking)}`)
  }

  if (options.text) {
    parts.push(options.text)
  }

  if (options.stats) {
    parts.push(`*${options.stats}*`)
  }

  return parts.join(CONTENT_SEPARATOR)
}
