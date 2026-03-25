/**
 * 流式响应内容格式化工具
 */

const CONTENT_SEPARATOR = '\n\n---\n\n'
const THINKING_LABEL = '💭 思考过程：\n\n'

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
    parts.push(`${THINKING_LABEL}${options.thinking}`)
  }

  if (options.text) {
    parts.push(options.text)
  }

  if (options.stats) {
    parts.push(`*${options.stats}*`)
  }

  return parts.join(CONTENT_SEPARATOR)
}
