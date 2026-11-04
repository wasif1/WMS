import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { ur } from './ur'

const root = join(__dirname, '..')
const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p) && !/i18n[\\/](ur|index)\./.test(p) ? [p] : [] })

function collect() {
  const keys = new Map<string, string>()
  for (const f of files(root)) {
    const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const lit = (a?: ts.Node): a is ts.StringLiteral => !!a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ['t', 'ts'].includes(n.expression.text) && lit(n.arguments[0])) keys.set(n.arguments[0].text, f)
      if (ts.isJsxAttribute(n) && n.name.getText() === 'k' && n.initializer && ts.isStringLiteral(n.initializer)) keys.set(n.initializer.text, f)
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  const perm = readFileSync(join(root, '..', 'server/src/permissions.ts'), 'utf8')
  for (const m of perm.matchAll(/label: '([^']+)', module: '([^']+)'/g)) { keys.set(m[1], 'permissions'); keys.set(m[2], 'permissions') }
  return keys
}
const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join()
const keep = new Set(['{type} #{id}', 'Demo-Passw0rd-2026', 'IP', '2FA', 'SKU', 'manager@company.com, finance@company.com'])

describe('Urdu translation coverage', () => {
  const keys = collect()
  it('translates every string the interface uses', () => {
    const missing = [...keys].filter(([k]) => !(k in ur)).map(([k, f]) => `${k}  (${f})`)
    expect(missing).toEqual([])
  })
  it('keeps {placeholders} identical to the English text', () => {
    expect(Object.entries(ur).filter(([k, v]) => ph(k) !== ph(v)).map(([k]) => k)).toEqual([])
  })
  it('actually translates (contains Urdu script) unless it is a code, address or pure placeholder', () => {
    const bad = Object.entries(ur).filter(([k, v]) => !keep.has(k) && !/[؀-ۿ]/.test(v) && !/^[\s{}\w]*$/.test(v) && !/^[\d\s≈{}\w]+$/.test(v))
    expect(bad.map(([k]) => k)).toEqual([])
  })
  it('has no stale entries for text no longer in the interface', () => {
    expect(Object.keys(ur).filter((k) => !keys.has(k))).toEqual([])
  })
})

describe('RTL-safe styling', () => {
  it('uses logical Tailwind classes (ms/me/ps/pe/start/end), not left/right ones', () => {
    const bad: string[] = []
    for (const f of files(root)) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/["'` ](?:-?(?:ml|mr|pl|pr)-\d|(?:left|right)-\d|text-(?:left|right)|border-[lr](?:-|\b)|rounded-[lr](?:-|\b))/.test(line.replace(/rtl:\S+|ltr:\S+/g, ''))) bad.push(`${f}:${i + 1}`)
      })
    }
    expect(bad).toEqual([])
  })
})
