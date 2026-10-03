import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const CANONICAL_REPOSITORY = 'Premieros/.com'
const CANONICAL_PROJECT_REF = 'hvqlkapynjfjikqithvd'
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', 'playwright-report'])
const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.json', '.yml', '.yaml',
  '.toml', '.env', '.example', '.cs', '.csproj', '.sql', '.cmd', '.ps1', '.html'
])
const SKIP_FILES = new Set(['package-lock.json'])

const failures = []

function shouldRead(filePath) {
  const base = path.basename(filePath)
  if (SKIP_FILES.has(base)) return false
  const ext = path.extname(filePath).toLowerCase()
  return TEXT_EXTENSIONS.has(ext) || base.startsWith('.env')
}

function inspectFile(filePath) {
  const rel = path.relative(ROOT, filePath).replaceAll(path.sep, '/')
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)

  lines.forEach((line, index) => {
    const lineNo = index + 1

    for (const match of line.matchAll(/Premieros\/([A-Za-z0-9_.-]*[A-Za-z0-9_-])/g)) {
      const full = `Premieros/${match[1]}`
      if (full !== CANONICAL_REPOSITORY) {
        failures.push(`${rel}:${lineNo} foreign repository reference: ${full}`)
      }
    }

    for (const match of line.matchAll(/(?:https:\/\/|wss:\/\/|db\.)([a-z0-9]{20})\.supabase\.co/g)) {
      if (match[1] !== CANONICAL_PROJECT_REF) {
        failures.push(`${rel}:${lineNo} foreign Supabase project URL/ref: ${match[1]}`)
      }
    }

    if (/supabase|project[_ -]?ref|production_project_ref/i.test(line)) {
      for (const match of line.matchAll(/\b[a-z0-9]{20}\b/g)) {
        if (match[0] !== CANONICAL_PROJECT_REF) {
          failures.push(`${rel}:${lineNo} foreign Supabase project ref: ${match[0]}`)
        }
      }
    }

    for (const match of line.matchAll(/premieros\.github\.io\/([^/'"\s]+)/gi)) {
      if (match[1] !== '.com') {
        failures.push(`${rel}:${lineNo} foreign GitHub Pages app path: ${match[1]}`)
      }
    }
  })
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.isFile() && shouldRead(full)) inspectFile(full)
  }
}

walk(ROOT)

if (failures.length) {
  console.error('PROJECT_REFERENCE_LOCK_FAILED')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Repository references verified: ${CANONICAL_REPOSITORY} -> ${CANONICAL_PROJECT_REF}`)
