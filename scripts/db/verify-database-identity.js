const EXPECTED_PROJECT_REF = 'azzdesuowpdcoflmyezn'
const EXPECTED_URL = `https://${EXPECTED_PROJECT_REF}.supabase.co`

const configuredUrl = (process.env.VITE_SUPABASE_URL || EXPECTED_URL).trim().replace(/\/$/, '')
const configuredRef = (process.env.SUPABASE_PROJECT_REF || EXPECTED_PROJECT_REF).trim()

function fail(message) {
  console.error(`DATABASE_IDENTITY_LOCK_FAILED: ${message}`)
  process.exit(1)
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
if (dbUrl && !/localhost|127\.0\.0\.1/.test(dbUrl)) {
  let dbHost = ''
  try {
    dbHost = new URL(dbUrl).hostname
  } catch {
    fail('SUPABASE_DB_URL is not a valid database URL')
  }

  const allowedHosts = new Set([
    `db.${EXPECTED_PROJECT_REF}.supabase.co`,
    `aws-0-eu-west-1.pooler.supabase.com`,
  ])

  if (!allowedHosts.has(dbHost)) {
    fail(`SUPABASE_DB_URL points to unexpected host ${dbHost}`)
  }

  if (dbHost.includes('pooler.supabase.com') && !dbUrl.includes(EXPECTED_PROJECT_REF)) {
    fail(`Pooler database URL must contain project ref ${EXPECTED_PROJECT_REF}`)
  }
}

console.log(`Database identity verified: ${EXPECTED_PROJECT_REF}`)
