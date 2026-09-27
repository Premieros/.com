const BLOCKED_PROJECT_REF = 'azzdesuowpdcoflmyezn'
const configuredRef = (process.env.SUPABASE_PROJECT_REF || '').trim()
const configuredUrl = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '')

function fail(message) {
  console.error(`DATABASE_IDENTITY_LOCK_FAILED: ${message}`)
  process.exit(1)
}

if (!configuredRef) {
  fail('SUPABASE_PROJECT_REF is required for the clean clone')
}

if (configuredRef === BLOCKED_PROJECT_REF) {
  fail(`The original Production project ${BLOCKED_PROJECT_REF} is permanently blocked in this repository`)
}

const expectedUrl = `https://${configuredRef}.supabase.co`
if (!configuredUrl) {
  fail('VITE_SUPABASE_URL is required for the clean clone')
}

if (configuredUrl !== expectedUrl) {
  fail(`VITE_SUPABASE_URL must be ${expectedUrl}, received ${configuredUrl}`)
}

let parsed
try {
  parsed = new URL(configuredUrl)
} catch {
  fail('VITE_SUPABASE_URL is not a valid URL')
}

if (parsed.protocol !== 'https:' || parsed.hostname !== `${configuredRef}.supabase.co`) {
  fail(`Supabase hostname must be ${configuredRef}.supabase.co`)
}

const dbUrl = (process.env.SUPABASE_DB_URL || '').trim()
if (dbUrl && !/localhost|127\.0\.0\.1/.test(dbUrl)) {
  if (dbUrl.includes(BLOCKED_PROJECT_REF)) {
    fail('SUPABASE_DB_URL must not point to the original Production project')
  }
  if (!dbUrl.includes(configuredRef)) {
    fail('SUPABASE_DB_URL must contain the configured clean-clone project ref')
  }
}

console.log(`Database identity verified: ${configuredRef}`)
