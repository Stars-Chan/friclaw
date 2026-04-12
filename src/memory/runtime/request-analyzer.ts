import type { RequestContext, RequestIntent } from './types'

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'will', 'your', 'about',
  '继续', '上次', '刚才', '之前', '这个', '那个', '一下', '一下子', '我们', '你们', '帮我', '处理', '看看', '一下子',
])

const CONTINUE_PATTERNS = [/继续/, /上次/, /刚才/, /之前/, /接着/, /延续/, /那个方案/, /那个项目/]
const QUESTION_PATTERNS = [/[?？]/, /怎么/, /什么/, /为何/, /为什么/, /如何/, /是否/, /能不能/]
const DECISION_PATTERNS = [/要不要/, /是否应该/, /选哪个/, /哪个更好/, /建议/, /决策/, /方案/]
const STATUS_PATTERNS = [/进展/, /状态/, /做到哪/, /完成了吗/, /卡住/, /阻塞/, /更新一下/]
const NEW_TASK_PATTERNS = [/新增/, /添加/, /创建/, /实现/, /开始/, /新建/, /做一个/, /开发/]

function detectIntent(text: string): RequestIntent {
  if (CONTINUE_PATTERNS.some(pattern => pattern.test(text))) return 'continue'
  if (QUESTION_PATTERNS.some(pattern => pattern.test(text))) return 'question'
  if (DECISION_PATTERNS.some(pattern => pattern.test(text))) return 'decision'
  if (STATUS_PATTERNS.some(pattern => pattern.test(text))) return 'status_update'
  if (NEW_TASK_PATTERNS.some(pattern => pattern.test(text))) return 'new_task'
  return 'unknown'
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function extractKeywords(text: string): string[] {
  const tokens = text.match(/[A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? []
  return unique(
    tokens
      .map(token => token.trim())
      .filter(token => token.length >= 2)
      .filter(token => !STOP_WORDS.has(token.toLowerCase()))
      .slice(0, 8)
  )
}

function extractEntities(text: string): string[] {
  const inlineCode = Array.from(text.matchAll(/`([^`]+)`/g)).map(match => match[1].trim())
  const englishNames = Array.from(text.matchAll(/\b[A-Z][A-Za-z0-9_-]{1,}\b/g)).map(match => match[0])
  const pathLikes = Array.from(text.matchAll(/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+/g)).map(match => match[0])
  return unique([...inlineCode, ...englishNames, ...pathLikes]).slice(0, 8)
}

export function analyzeRequest(text: string): RequestContext {
  return {
    rawText: text,
    keywords: extractKeywords(text),
    entities: extractEntities(text),
    intent: detectIntent(text),
  }
}
