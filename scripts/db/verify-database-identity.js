import fs from 'node:fs'
import path from 'node:path'

const EXPECTED_REPOSITORY = 'Premieros/.com'
const EXPECTED_PROJECT_REF = 'hvqlkapynjfjikqithvd'
const EXPECTED_PROJECT_URL = `https://${EXPECTED_PROJECT_REF}.supabase.co`

function fail(message) {
  console.error(`DATABASE_IDENTITY_LOCK_FAILED: ${message}`)
  process.exit(1)
}

const configuredRepository = (process.env.GITHUB_REPOSITORY || EXPECTED_REPOSITORY).trim()
const configuredRef = (process.env.SUPABASE_PROJECT_REF || EXPECTED_PROJECT_REF).trim()
const configuredUrl = (process.env.VITE_SUPABASE_URL || EXPECTED_PROJECT_URL).trim().replace(/\/$/, '')

if (configuredRepository !== EXPECTED_REPOSITORY) {
  fail(`GITHUB_REPOSITORY must be ${EXPECTED_REPOSITORY}, received ${configuredRepository || '<empty>'}`)
}

if (configuredRef !== EXPECTED_PROJECT_REF) {
  fail(`SUPABASE_PROJECT_REF must be ${EXPECTED_PROJECT_REF}, received ${configuredRef || '<empty>'}`)
}

if (configuredUrl !== EXPECTED_PROJECT_URL) {
  fail(`VITE_SUPABASE_URL must be ${EXPECTED_PROJECT_URL}, received ${configuredUrl || '<empty>'}`)
}

let parsed
try {
  parsed = new URL(configuredUrl)
} catch {
  fail('VITE_SUPABASE_URL is not a valid URL')
}

if (parsed.protocol !== 'https:' || parsed.hostname !== `${EXPECTED_PROJECT_REF}.supabase.co`) {
  fail(`Supabase hostname must be ${EXPECTED_PROJECT_REF}.supabase.co`)
}

const dbUrl = (process.env.SUPABASE_DB_URL || '').trim()
if (dbUrl && !/localhost|127\.0\.0\.1/.test(dbUrl) && !dbUrl.includes(EXPECTED_PROJECT_REF)) {
  fail('SUPABASE_DB_URL must point to the locked Premieros/.com Supabase project')
}

const textExtensions = new Set([
  '.md', '.txt', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.json', '.yml', '.yaml',
  '.toml', '.env', '.example', '.cs', '.sql', '.html', '.css', '.scss', '.sh', '.ps1',
])
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'coverage', 'playwright-report'])

function scanDirectory(dir, violations) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      scanDirectory(fullPath, violations)
      continue
    }

    const ext = path.extname(entry.name).toLowerCase()
    if (!textExtensions.has(ext) && entry.name !== '.env' && entry.name !== '.env.example') continue

    let text
    try {
      text = fs.readFileSync(fullPath, 'utf8')
    } catch {
      continue
    }

    const relative = path.relative(process.cwd(), fullPath).replaceAll('\\', '/')
    const lines = text.split(/\r?\n/)

    lines.forEach((line, index) => {
      const lineNumber = index + 1

      for (const match of line.matchAll(/https:\/\/([a-z]{20})\.supabase\.co/gi)) {
        if (match[1] !== EXPECTED_PROJECT_REF) {
          violations.push(`${relative}:${lineNumber} foreign Supabase project`)
        }
      }

      if (/supabase/i.test(line)) {
        for (const match of line.matchAll(/\b([a-z]{20})\b/g)) {
          if (match[1] !== EXPECTED_PROJECT_REF) {
            violations.push(`${relative}:${lineNumber} foreign Supabase project ref`)
          }
        }
      }

      for (const match of line.matchAll(/\bPremieros\/([A-Za-z0-9_.-]+)\b/g)) {
        if (`Premieros/${match[1]}` !== EXPECTED_REPOSITORY) {
          violations.push(`${relative}:${lineNumber} foreign Premieros repository`)
        }
      }
    })
  }
}

const violations = []
scanDirectory(process.cwd(), violations)
const uniqueViolations = [...new Set(violations)]

if (uniqueViolations.length) {
  console.error('Foreign project/database references found:')
  for (const violation of uniqueViolations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log(`Project identity verified: ${EXPECTED_REPOSITORY} -> ${EXPECTED_PROJECT_REF}`)
