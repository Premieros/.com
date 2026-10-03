const EXPECTED_REPOSITORY = 'Premieros/.com'
const EXPECTED_PROJECT_REF = 'cuitndfayupfysejlpda'
const EXPECTED_URL = `https://${EXPECTED_PROJECT_REF}.supabase.co`

function fail(message) {
  console.error(`DATABASE_IDENTITY_LOCK_FAILED: ${message}`)
  process.exit(1)
}

const configuredRepository = (process.env.GITHUB_REPOSITORY || EXPECTED_REPOSITORY).trim()
const configuredRef = (process.env.SUPABASE_PROJECT_REF || EXPECTED_PROJECT_REF).trim()
const configuredUrl = (process.env.VITE_SUPABASE_URL || EXPECTED_URL).trim().replace(/\/$/, '')

if (configuredRepository !== EXPECTED_REPOSITORY) {
  fail(`GITHUB_REPOSITORY must be ${EXPECTED_REPOSITORY}, received ${configuredRepository || '<empty>'}`)
}

if (configuredRef !== EXPECTED_PROJECT_REF) {
  fail(`SUPABASE_PROJECT_REF must be ${EXPECTED_PROJECT_REF}, received ${configuredRef || '<empty>'}`)
}

if (configuredUrl !== EXPECTED_URL) {
  fail(`VITE_SUPABASE_URL must be ${EXPECTED_URL}, received ${configuredUrl || '<empty>'}`)
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
  fail('Remote SUPABASE_DB_URL must belong to the canonical Supabase project')
}

console.log(`Project identity verified: ${EXPECTED_REPOSITORY} -> ${EXPECTED_PROJECT_REF}`)
